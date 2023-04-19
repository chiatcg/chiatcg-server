import { ScriptName } from '../appraise';
import { IPlayerPushProvider } from '../dependencies';
import { randInt } from '../utils';
import { CardMod } from './card-mods';
import { CardScriptComp } from './card-script-comp';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

export class CardScript {
    static deserialize(scriptData: CardScript.ScriptData, card: GameEngine.ICardState): CardScript {
        const scriptCtor = (CardScript as Record<ScriptName, CardScript.CardScriptConstructor>)[scriptData[0]];
        if (!scriptCtor) {
            throw new Error('cannot find script: ' + scriptData.join());
        }
        return new scriptCtor(card, ...scriptData.slice(1));
    }

    public scriptData: CardScript.ScriptData;

    constructor(
        extraScriptData: unknown[],
        public cooldown = 0,
        public findTargets: CardScript.ITargetFinder,
        public targetCompPairs: { targetResolver: CardScript.ITargetResolver, comps: CardScriptComp.ICardScriptComp[] }[],
    ) {
        this.scriptData = [this.constructor.name as ScriptName, ...extraScriptData];
        const cooldownData = this.scriptData.find((x): x is ['$cooldown', number] => Array.isArray(x) && x[0] === '$cooldown');
        if (cooldownData?.length) {
            this.cooldown = cooldownData[1];
        }
    }

    equals(other: CardScript) {
        return this.equalsData(other.scriptData);
    }

    equalsData(other: CardScript.ScriptData, strict = false) {
        // Caveat: could collide since join() flattens array but highly unlikely
        return strict ? (this.scriptData.join('') === other.join('')) : (this.scriptData[0] === other[0]);
    }

    execute(gameData: GameEngine.IGameData, sourceCard: GameEngine.ICardState, targetCard: GameEngine.ICardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        const isEnemy = GameEngineUtils.isEnemyCard(sourceCard);
        if (!isEnemy) {
            if (!sourceCard.scripts.find(x => this.equalsData(x))) {
                throw new Error('PlayerCard does not have script: ' + this.scriptData.join());
            }
        }

        const targets = this.findTargets(gameData, sourceCard);
        if (!targets.find(x => x.id === targetCard.id)) {
            if (!isEnemy) {
                throw new Error('Invalid target');
            };
            return;
        }

        for (const pair of this.targetCompPairs) {
            const resolvedTargets = pair.targetResolver(gameData, sourceCard, targetCard);
            for (const comp of pair.comps) {
                for (const resolvedTarget of resolvedTargets) {
                    comp(gameData, sourceCard, resolvedTarget, broadcast);
                }
            }
        }

        if (this.cooldown) {
            sourceCard.scripts.findAndRemoveFirst(x => this.equalsData(x));

            const cooldownModData = new CardMod.scriptCooldown(this.cooldown + 1, this.scriptData).modData;
            sourceCard.mods.push(cooldownModData);

            broadcast.push({
                type: 'cardScriptOnCooldown',
                cardId: sourceCard.id,
                cooldownMod: cooldownModData,
            });
        }
    }
}
export namespace CardScript {
    export type CardScriptConstructor = { new(card: GameEngine.ICardState, ...args: any[]): CardScript }
    export type ScriptData = [ScriptName, ...unknown[]];

    export interface ITargetResolver {
        (gameData: GameEngine.IGameData, sourceCard: GameEngine.ICardState, targetCard: GameEngine.ICardState): GameEngine.ICardState[];
    }

    export interface ITargetFinder {
        (gameData: GameEngine.IGameData, card: GameEngine.ICardState): GameEngine.ICardState[];
    }

    export namespace TargetResolvers {
        export const Self: ITargetResolver = (_, sourceCard) => [sourceCard];

        export const Target: ITargetResolver = (_, _2, targetCard) => [targetCard];

        export const TargetAndAdjacents: ITargetResolver = (gameData, _, targetCard) => {
            const cards = GameEngineUtils.isEnemyCard(targetCard) ? gameData.enemies : (GameEngineUtils.findPlayerByCardId(gameData, targetCard.id).cards);
            const i = cards.indexOf(targetCard as any);
            return i === 0 ? cards.slice(0, 2) : cards.slice(i - 1, 3);
        };

        export const AllAllies: ITargetResolver = (gameData, sourceCard) => {
            if (GameEngineUtils.isEnemyCard(sourceCard)) {
                return gameData.enemies;
            } else {
                return GameEngineUtils.getPlayerCards(gameData);
            }
        };

        export const RandomAlly: ITargetResolver = (gameData, sourceCard, targetCard) => {
            return [AllAllies(gameData, sourceCard, targetCard).random()];
        };

        export const AllOpponents: ITargetResolver = (gameData, sourceCard) => {
            if (GameEngineUtils.isEnemyCard(sourceCard)) {
                return GameEngineUtils.getPlayerCards(gameData);
            } else {
                return gameData.enemies;
            }
        };

        export const RandomOpponent: ITargetResolver = (gameData, sourceCard, targetCard) => {
            return [AllOpponents(gameData, sourceCard, targetCard).random()];
        };
    }

    export namespace TargetFinders {
        export const Self: ITargetFinder = (_gameData, card) => [card];

        export const Allies: ITargetFinder = (gameData, card) => {
            if (GameEngineUtils.isEnemyCard(card)) {
                return _filter(gameData.enemies);
            } else {
                return _filter(GameEngineUtils.getPlayerCards(gameData));
            }
        };

        export const Opponents: ITargetFinder = (gameData, card) => {
            if (GameEngineUtils.isEnemyCard(card)) {
                return _filter(GameEngineUtils.getPlayerCards(gameData));
            } else {
                return _filter(gameData.enemies);
            }
        };

        export const Any: ITargetFinder = (gameData, _card) => {
            return _filter([...GameEngineUtils.getPlayerCards(gameData), ...gameData.enemies]);
        };

        const _filter = (cards: GameEngine.ICardState[]) =>
            cards.filter(x => !x.mods.find(y => y.includes('freeze')));

        export const _ModFilter = (modFilter: string[], targetFinder: ITargetFinder): ITargetFinder =>
            (gameData, card) => {
                const targets = targetFinder(gameData, card);
                return targets.filter(target => target.mods.find(modData => modFilter.includes(modData[0] as string)));
            };
    }

    // Defines a card script - the class name must match a script name in a appraised card
    export class bf_bruteforce extends CardScript {
        constructor(
            // MUST always be the first parameter even if not used
            card: GameEngine.ICardState,

            // Not used but declared to show how the memo is passed back here, see first argument in super(...) below
            _damage: number,
        ) {
            const damage = card.cpu * 10;

            super(
                // Any extra data to serialize into this.scriptData as a 'memo' which can serve two purposes:
                // 1) the client relies on the memo to display potential card effects in the UI instead calculating it independently
                // 2) memo is passed back into the constructor during deserialization, useful for dynamic AI scripts,
                //      see _Attack below for example
                [damage],

                // Cooldown
                0,

                // Which cards are valid targets for this card; AI will typically .random()
                TargetFinders.Opponents,

                // A composition of CardScriptComps that get executed when this card is played; this allows for
                // composition effects such as "((damage and debuff) to target) AND (chance to stun neighbors)":
                // The first component would use the Target resolver and Attack and ApplyMod comps
                // The second component would use the Neighbors resolver and curry Stun comp into _Chance comp
                [
                    {
                        // Given a chosen target, which actual targets these comps will execute on; this allows
                        // a card to, for example, deal damage to the neighbors of the specified target
                        targetResolver: TargetResolvers.Target,

                        // CardScriptComps to execute on the resolved targets
                        comps: [
                            CardScriptComp.Attack(damage, true),
                        ],
                    }
                ],
            );
        }
    }

    export class bf_flood extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = card.cpu * 7;
            const stunChance = card.cpu / 6;

            super(
                [damage, stunChance],
                1,
                TargetFinders.Opponents,
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.Attack(damage, true),
                            CardScriptComp._Chance(stunChance, CardScriptComp.ApplyMod(['stun', ['$duration', 1]])),
                        ],
                    }
                ],
            );
        }
    }

    export class bf_ddos extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                2,
                TargetFinders.Any,
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.ApplyMod(['freeze', ['$duration', 1]]),
                        ],
                    }
                ],
            );
        }
    }

    export class bf_multicast extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = card.cpu * 4;

            super(
                [damage],
                2,
                TargetFinders.Opponents,
                [
                    {
                        targetResolver: TargetResolvers.TargetAndAdjacents,
                        comps: [
                            CardScriptComp.Attack(damage, true),
                        ],
                    }
                ],
            );
        }
    }

    export class bf_obfuscate extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = card.cpu * 9;

            super(
                [damage],
                2,
                TargetFinders.Any,
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.RaiseSec(damage),
                        ],
                    }
                ],
            );
        }
    }

    export class bd_backdoor extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = card.cpu * 6;
            const bdChance = card.cpu / 6;

            super(
                [damage, bdChance],
                0,
                TargetFinders.Opponents,
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.Attack(damage, true),
                            CardScriptComp._Chance(bdChance, CardScriptComp.ApplyMod(['backdoor', damage])),
                        ],
                    }
                ],
            );
        }
    }

    export class bd_disconnect extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                3,
                TargetFinders._ModFilter(['backdoor'], TargetFinders.Opponents),
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.ApplyMod(['stun', ['$duration', 3]]),
                        ],
                    }
                ],
            );
        }
    }

    export class bd_disrupt extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                0,
                TargetFinders._ModFilter(['backdoor'], TargetFinders.Opponents),
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.ApplyMod(['stun', ['$duration', 1]]),
                        ],
                    }
                ],
            );
        }
    }

    export class bd_feedback extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = card.cpu * 4;

            super(
                [damage],
                0,
                TargetFinders._ModFilter(['backdoor'], TargetFinders.Opponents),
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.ApplyMod(['feedback', card.cpu * 4 | 0]),
                        ],
                    }
                ],
            );
        }
    }

    export class bd_reboot extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                3,
                TargetFinders._ModFilter(['backdoor'], TargetFinders.Opponents),
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.ApplyMod(['freeze', ['$duration', 3]]),
                        ],
                    }
                ],
            );
        }
    }

    export class bd_tunnel extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                2,
                TargetFinders._ModFilter(['backdoor'], TargetFinders.Opponents),
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.MemDmg(1),
                        ],
                    }
                ],
            );
        }
    }


    export class mw_malware extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const minDamage = card.cpu * 6;
            const maxDamage = card.cpu * 12;

            super(
                [minDamage, maxDamage],
                0,
                TargetFinders.Opponents,
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.Attack(randInt(card.cpu * 6, card.cpu * 12), true),
                        ],
                    }
                ],
            );
        }
    }

    export class mw_phishing extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const minDamage = card.cpu * 8;
            const maxDamage = card.cpu * 16;

            super(
                [minDamage, maxDamage],
                0,
                TargetFinders.Self,
                [
                    {
                        targetResolver: TargetResolvers.RandomOpponent,
                        comps: [
                            CardScriptComp.Attack(randInt(card.cpu * 8, card.cpu * 16), true),
                        ],
                    }
                ],
            );
        }
    }

    export class mw_shareware extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const minBonus = card.cpu * 10;
            const maxBonus = card.cpu * 20;

            super(
                [minBonus, maxBonus],
                0,
                TargetFinders.Self,
                [
                    {
                        targetResolver: TargetResolvers.RandomAlly,
                        comps: [
                            CardScriptComp.RaiseSec(randInt(card.cpu * 10, card.cpu * 20)),
                        ],
                    }
                ],
            );
        }
    }

    export class mw_freeware extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const minBonus = card.cpu * 8;
            const maxBonus = card.cpu * 14;

            super(
                [minBonus, maxBonus],
                0,
                TargetFinders.Any,
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.RaiseSec(randInt(card.cpu * 8, card.cpu * 14)),
                        ],
                    }
                ],
            );
        }
    }

    export class mw_spoof extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                0,
                TargetFinders.Opponents,
                [
                    {
                        targetResolver: TargetResolvers.Target,
                        comps: [
                            CardScriptComp.RedirectIntentRandom,
                        ],
                    }
                ],
            );
        }
    }
}