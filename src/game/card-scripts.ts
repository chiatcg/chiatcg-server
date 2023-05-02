import { CoreScriptNames } from '../appraise';
import { IPlayerPushProvider } from '../dependencies';
import { randInt, round } from '../utils';
import { CardMod } from './card-mods';
import { CardScriptComp } from './card-script-comp';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

export class CardScript {
    cooldown = -1;

    readonly scriptName: string;

    constructor(
        private _extraScriptData: unknown[],
        public targetFinder: CardScript.ITargetFinder,
        public targetCompPairs: { targetResolver: CardScript.ITargetResolver, comps: CardScriptComp.IScriptComp[] }[],
    ) {
        this.scriptName = this.constructor.name;
    }

    serialize() {
        const retVal = [this.scriptName, ...this._extraScriptData] as CardScript.ScriptData;
        (this.cooldown > 0) && retVal.push(CardScript.makeCooldownData(this.cooldown));
        return retVal;
    }


    static areEqual(left: CardScript.ScriptData, right: CardScript.ScriptData) {
        // Caveat: could collide since join() flattens array but highly unlikely
        return left.join('') === right.join('');
    }

    static deserialize(card: GameEngine.ICardState, scriptData: CardScript.ScriptData) {
        const scriptCtor = (CardScript.Content as CardScript.ScriptLibrary)[scriptData[0]];
        if (!scriptCtor) throw new Error('script not found: ' + scriptData.join());

        return new scriptCtor(card, ...scriptData.slice(1));
    }

    static execute(gameData: GameEngine.IGameData, sourceCard: GameEngine.ICardState, sourceCardScript: CardScript.ScriptData, targetCard: GameEngine.ICardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        broadcast.push({
            type: 'cardExecuting',
            cardId: sourceCard.id,
            targetCardId: targetCard.id,
            scriptData: sourceCardScript,
        });

        if (this.isOnCooldown(sourceCardScript)) {
            throw new Error('Script is on cooldown: ' + sourceCardScript.join());
        }

        const scriptDataFromCard = sourceCard.scripts.find(x => CardScript.areEqual(x, sourceCardScript));
        const isEnemy = GameEngineUtils.isEnemyCard(sourceCard);
        if (!isEnemy) {
            if (!scriptDataFromCard) {
                throw new Error('PlayerCard does not have script: ' + sourceCardScript.join());
            }
        }

        const builder = this.deserialize(sourceCard, sourceCardScript);

        if (builder.targetFinder !== CardScript.TargetFinders.Self) {
            const targets = builder.targetFinder(gameData, sourceCard);
            if (!targets.find(x => x.id === targetCard.id)) {
                if (!isEnemy) {
                    throw new Error('Invalid target ' + targets.map(x => x.id).join());
                };

                broadcast.push({
                    type: 'cardExecuted',
                    cardId: sourceCard.id,
                    targetCardId: targetCard.id,
                    scriptData: scriptDataFromCard || sourceCardScript,
                });
                return;
            }
        }

        for (const pair of builder.targetCompPairs) {
            const resolvedTargets = pair.targetResolver(gameData, sourceCard, targetCard);
            for (const comp of pair.comps) {
                for (const resolvedTarget of resolvedTargets) {
                    if (resolvedTarget.isRemoved) continue;

                    comp(gameData, sourceCard, resolvedTarget, broadcast);
                }
            }
        }

        const cooldownData = CardScript.findCooldownData(scriptDataFromCard || sourceCardScript);
        if (cooldownData) {
            cooldownData[1] = cooldownData[2] + 1;
        }

        broadcast.push({
            type: 'cardExecuted',
            cardId: sourceCard.id,
            targetCardId: targetCard.id,
            scriptData: scriptDataFromCard || sourceCardScript,
        });
    }

    static findCooldownData(data: CardScript.ScriptData) {
        return data.find((x): x is CardScript.CooldownData => Array.isArray(x) && x[0] === '$cooldown');
    }

    static fromScriptName(card: GameEngine.ICardState, scriptName: string) {
        return this.deserialize(card, [scriptName]).serialize();
    }

    static isOnCooldown(data: CardScript.ScriptData) {
        return (this.findCooldownData(data)?.[1] || 0) > 0;
    }

    static makeCooldownData(max: number, cur = 0): CardScript.CooldownData {
        return ['$cooldown', cur, max];
    }

    static tickCooldowns(card: GameEngine.ICardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        for (const script of card.scripts) {
            const cooldownData = CardScript.findCooldownData(script);
            if (!cooldownData?.[1]) {
                continue;
            }

            cooldownData[1]--;

            broadcast.push({
                type: 'scriptChanged',
                cardId: card.id,
                scriptData: script,
            });
        }
    }
}
export namespace CardScript {
    export type ScriptData = [string, ...unknown[]];
    export type CooldownData = ['$cooldown', number, number];
    export type ScriptConstructor = { new(card: GameEngine.ICardState, ...args: any[]): CardScript };
    export type ScriptLibrary = Record<string, ScriptConstructor>;

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
            const targets = GameEngineUtils.isEnemyCard(card) ? gameData.enemies : GameEngineUtils.getPlayerCards(gameData);
            return _excludeOffline(targets);
        };

        export const Opponents = (ignoreTaunt = false): ITargetFinder =>
            (gameData, card) => {
                const targets = GameEngineUtils.isEnemyCard(card) ? GameEngineUtils.getPlayerCards(gameData) : gameData.enemies;
                const nonFrozens = _excludeOffline(targets);
                if (!ignoreTaunt) {
                    const taunts = _filterForFirewall(nonFrozens);
                    if (taunts.length) {
                        return taunts;
                    }
                }
                return nonFrozens;
            };

        export const Any: ITargetFinder = (gameData, _card) => {
            return _excludeOffline([...GameEngineUtils.getPlayerCards(gameData), ...gameData.enemies]);
        };

        export const _ModFilter = <T extends CardMod.ModLibrary, K extends (keyof T & string)>(modFilter: K[], targetFinder: ITargetFinder): ITargetFinder =>
            (gameData, card) => {
                const targets = targetFinder(gameData, card);
                const modMatches = targets.filter(target => target.mods.find(modData => modFilter.find(x => x === modData[0])));
                return _excludeOffline(modMatches);
            };

        const _excludeOffline = (cards: GameEngine.ICardState[]) => {
            return cards.filter(x => !x.mods.find(y => y[0] === 'offline'));
        }

        const _filterForFirewall = (cards: GameEngine.ICardState[]) => {
            return cards.filter(x => x.mods.find(y => y[0] === 'firewall') && !x.mods.find(y => y[0] === 'offline'));
        }
    }


    export namespace Content {
        // Defines a card script - the class name is treated as the script name
        export class bd_decode extends CardScript {
            constructor(
                // MUST always be the first parameter even if not used
                card: GameEngine.ICardState,
                // Not used but declared to show how the memo is passed back here, see first argument in super(...) below
                _secDamage: number,
            ) {
                const secDamage = card.cpu * 12;

                super(
                    // Any extra data to serialize into scriptData[1:] as a 'memo' which can serve two purposes:
                    // 1) the client relies on the memo to display potential card effects in the UI instead calculating it independently
                    // 2) memo is passed back into the constructor during deserialization, useful for dynamic AI scripts
                    [secDamage],

                    // Which cards are valid targets for this card; AI will typically .random()
                    TargetFinders.Opponents(),

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
                                CardScriptComp.SecDmg(secDamage, true),
                            ],
                        }
                    ],
                );
            }
        }

        export class bd_exploit extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const damage = card.cpu * 6;
                const bdChance = round(card.cpu / 6, 2);

                super(
                    [damage, bdChance],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.Attack(damage, true),
                                CardScriptComp._TargetHasMod<typeof CardMod.Content, 'exploited'>('exploited', mod => CardScriptComp.Attack(mod.stackingConfig.rank, false)),
                                CardScriptComp._Chance(bdChance,
                                    CardScriptComp.AddMod(
                                        new CardMod.Content.exploited(damage),
                                    )
                                ),
                            ],
                        }
                    ],
                );
            }
        }

        export class bd_secure extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const secBonus = card.cpu * 10;
                super(
                    [secBonus],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.RaiseSec(secBonus),
                            ],
                        }
                    ],
                );
            }
        }

        export class bf_spam extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const damage = card.cpu * 10;
                super(
                    [damage],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.Attack(damage, true),
                            ],
                        }
                    ]
                );
            }
        }

        export class bf_firewall extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const secBonus = card.cpu * 6;
                const modDuration = 1;

                super(
                    [secBonus, modDuration],
                    TargetFinders.Self,
                    [
                        {
                            targetResolver: TargetResolvers.Self,
                            comps: [
                                CardScriptComp.AddMod(
                                    new CardMod.Content.firewall(modDuration),
                                ),
                                CardScriptComp.RaiseSec(secBonus),
                            ],
                        }
                    ],
                );
                this.cooldown = 1;
            }
        }

        export class bf_obfuscate extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const secBonus = card.cpu * 9;

                super(
                    [secBonus],
                    TargetFinders.Any,
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.RaiseSec(secBonus),
                            ],
                        }
                    ],
                );
            }
        }

        export class mw_worm extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const minDamage = card.cpu * 6;
                const maxDamage = card.cpu * 12;

                super(
                    [minDamage, maxDamage],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.Attack(randInt(minDamage, maxDamage), true),
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
                    TargetFinders.Any,
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.RaiseSec(randInt(minBonus, maxBonus)),
                            ],
                        }
                    ],
                );
            }
        }

        export class mw_forward extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const tempSecBonus = card.cpu * 7;
                const duration = 1;

                super(
                    [tempSecBonus, duration],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.AddMod(
                                    new CardMod.Content.secured(tempSecBonus, duration),
                                ),
                                CardScriptComp.AddMod(
                                    new CardMod.Content.firewall(duration),
                                ),
                            ],
                        }
                    ],
                );
            }
        }

        export class _attack extends CardScript {
            constructor(card: GameEngine.ICardState, strength: 'weak' | 'normal' | 'strong' = 'normal', cooldown = 0) {
                let damage = card.cpu;
                switch (strength) {
                    case 'weak': damage *= 7; break;
                    case 'normal': damage *= 10; break;
                    case 'strong': damage *= 13; break;
                }

                super(
                    [strength, cooldown, damage],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.Attack(damage, true),
                            ],
                        }
                    ],
                );
                this.cooldown = cooldown;
            }
        }

        export class _defend extends CardScript {
            constructor(card: GameEngine.ICardState, strength: 'weak' | 'normal' | 'strong' = 'normal', cooldown = 0) {
                let secBonus = card.cpu;
                switch (strength) {
                    case 'weak': secBonus *= 7; break;
                    case 'normal': secBonus *= 10; break;
                    case 'strong': secBonus *= 13; break;
                }

                super(
                    [strength, cooldown, secBonus],
                    TargetFinders.Allies,
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.RaiseSec(secBonus),
                            ],
                        }
                    ],
                );
                this.cooldown = cooldown;
            }
        }

        export class _firewallSelf extends CardScript {
            constructor(_card: GameEngine.ICardState, duration = 1, cooldown = 0) {
                super(
                    [duration, cooldown],
                    TargetFinders.Self,
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            comps: [
                                CardScriptComp.AddMod(
                                    new CardMod.Content.firewall(duration),
                                ),
                            ],
                        }
                    ],
                );
                this.cooldown = cooldown;
            }
        }
    }
    (Content as Record<CoreScriptNames, ScriptConstructor>);
}