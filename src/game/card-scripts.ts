import { CoreScriptNames } from '../appraise';
import { IPlayerPushProvider } from '../dependencies';
import { randInt, round } from '../utils';
import { CardMod } from './card-mods';
import { CardScriptParts } from './card-script-parts';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

export class CardScript {
    cooldownMax = -1;
    cooldownCur = 0;

    readonly scriptName: string;

    constructor(
        private _extraScriptData: unknown[],
        public targetFinder: CardScript.ITargetFinder,
        public targetScriptParts: { targetResolver: CardScript.ITargetResolver, parts: CardScriptParts.IScriptPart[] }[],
    ) {
        this.scriptName = this.constructor.name;
    }

    serialize() {
        const retVal = [this.scriptName, ...this._extraScriptData] as CardScript.ScriptData;
        (this.cooldownCur > 0 || this.cooldownMax > 0) && retVal.push(CardScript.makeCooldownData(this.cooldownMax, this.cooldownCur));
        return retVal;
    }

    static addScript(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, scriptData: CardScript.ScriptData) {
        card.scripts.push(scriptData);
        engine.broadcast.push({
            type: 'scriptAdded',
            cardId: card.id,
            scriptData,
        });
    }

    static areEqual(left: CardScript.ScriptData, right: CardScript.ScriptData) {
        // Caveat: could collide since join() flattens array but highly unlikely
        return left.join('') === right.join('');
    }

    static deserialize(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, scriptData: CardScript.ScriptData) {
        const scriptCtor = engine.ruleset.cardScripts?.[scriptData[0]];
        if (!scriptCtor) throw new Error('script not found: ' + scriptData.join());

        const script = new scriptCtor(card, ...scriptData.slice(1));
        const cooldownData = CardScript.findCooldownData(scriptData);
        if (cooldownData) {
            script.cooldownCur = cooldownData[1];
            script.cooldownMax = cooldownData[2];
        }
        return script;
    }

    static execute(engine: GameEngine.IGameEngine, sourceCard: GameEngine.ICardState, sourceCardScript: CardScript.ScriptData, targetCard: GameEngine.ICardState) {
        engine.broadcast.push({
            type: 'cardExecuting',
            cardId: sourceCard.id,
            targetCardId: targetCard.id,
            scriptData: sourceCardScript,
        });

        if (this.isOnCooldown(sourceCardScript)) {
            throw new Error('Script is on cooldown: ' + sourceCardScript.join());
        }

        const scriptDataFromCard = sourceCard.scripts.find(x => CardScript.areEqual(x, sourceCardScript));
        const isEnemy = GameEngineUtils.isEnemyCard(engine.gameData, sourceCard);
        if (!isEnemy) {
            if (!scriptDataFromCard) {
                throw new Error('PlayerCard does not have script: ' + sourceCardScript.join());
            }
        }

        const cooldownData = CardScript.findCooldownData(scriptDataFromCard || sourceCardScript);
        if (cooldownData) {
            cooldownData[1] = cooldownData[2] + 1;
        }

        const script = this.deserialize(engine, sourceCard, sourceCardScript);
        const targets = script.targetFinder(engine.gameData, sourceCard);
        if (!isEnemy && (!targets.length || !targets.find(x => x.id === targetCard.id))) {
            throw new Error('Invalid target ' + targets.map(x => x.id).join());
        }

        for (const pair of script.targetScriptParts) {
            const resolvedTargets = pair.targetResolver(engine.gameData, sourceCard, targetCard);
            for (const part of pair.parts) {
                for (const resolvedTarget of resolvedTargets) {
                    if (resolvedTarget.isRemoved) continue;

                    part(engine, sourceCard, resolvedTarget);
                }
            }
        }

        engine.broadcast.push({
            type: 'cardExecuted',
            cardId: sourceCard.id,
            targetCardId: targetCard.id,
            scriptData: scriptDataFromCard || sourceCardScript,
        });
    }

    static findCooldownData(data: CardScript.ScriptData) {
        return data.find((x): x is CardScript.CooldownData => Array.isArray(x) && x[0] === '$cooldown');
    }

    static fromScriptName(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, scriptName: string) {
        return this.deserialize(engine, card, [scriptName]).serialize();
    }

    static isOnCooldown(data: CardScript.ScriptData) {
        return (this.findCooldownData(data)?.[1] || 0) > 0;
    }

    static makeCooldownData(max: number, cur = 0): CardScript.CooldownData {
        return ['$cooldown', cur, max];
    }

    static removeScript(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, scriptType: CardScript.ScriptConstructor) {
        const removed = card.scripts.findAndRemoveFirst(x => x[0] === scriptType.name);
        if (!removed) throw new Error('script not found: ' + scriptType.name);

        engine.broadcast.push({
            type: 'scriptRemoved',
            cardId: card.id,
            removedScript: scriptType.name,
        });
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
            const cards = GameEngineUtils.isEnemyCard(gameData, targetCard) ? gameData.enemies : (GameEngineUtils.findPlayerByCardId(gameData, targetCard.id).cards);
            const i = cards.findIndex(x => x.id === targetCard.id);
            return [cards[i], cards[i - 1], cards[i + 1]].filter(Boolean);
        };

        export const AllAllies: ITargetResolver = (gameData, sourceCard) => {
            if (GameEngineUtils.isEnemyCard(gameData, sourceCard)) {
                return TargetFinders._excludeOffline(gameData.enemies);
            } else {
                return TargetFinders._excludeOffline(GameEngineUtils.getPlayerCards(gameData));
            }
        };

        export const RandomAlly: ITargetResolver = (gameData, sourceCard, targetCard) => {
            return [AllAllies(gameData, sourceCard, targetCard).random()];
        };

        export const AllOpponents: ITargetResolver = (gameData, sourceCard) => {
            if (GameEngineUtils.isEnemyCard(gameData, sourceCard)) {
                return TargetFinders._excludeImperviousAndOffline(GameEngineUtils.getPlayerCards(gameData));
            } else {
                return TargetFinders._excludeImperviousAndOffline(gameData.enemies);
            }
        };

        export const RandomOpponent: ITargetResolver = (gameData, sourceCard, targetCard) => {
            return TargetFinders._excludeImperviousAndOffline([AllOpponents(gameData, sourceCard, targetCard).random()]);
        };
    }

    export namespace TargetFinders {
        export const Self: ITargetFinder = (_gameData, card) => [card];

        export const Allies = (excludeSelf = false): ITargetFinder =>
            (gameData, card) => {
                let targets: GameEngine.ICardState[] = GameEngineUtils.isEnemyCard(gameData, card) ? gameData.enemies : GameEngineUtils.getPlayerCards(gameData);
                excludeSelf && (targets = targets.filter(x => x.id !== card.id));
                return _excludeOffline(targets);
            };

        export const Opponents = (ignoreTaunt = false): ITargetFinder =>
            (gameData, card) => {
                const targets = GameEngineUtils.isEnemyCard(gameData, card) ? GameEngineUtils.getPlayerCards(gameData) : gameData.enemies;
                const standardTargets = _excludeImperviousAndOffline(targets);
                if (!ignoreTaunt) {
                    const taunts = _filterForFirewall(standardTargets);
                    if (taunts.length) {
                        return taunts;
                    }
                }
                return standardTargets;
            };

        export const Any = (ignoreTaunt = false): ITargetFinder =>
            (gameData, card) => [
                ...Opponents(ignoreTaunt)(gameData, card),
                ...Allies()(gameData, card),
            ];

        export const _ModFilter = <T extends CardMod.ModLibrary, K extends (keyof T & string)>(modFilter: K[], targetFinder: ITargetFinder): ITargetFinder =>
            (gameData, card) => {
                const targets = targetFinder(gameData, card);
                const modMatches = targets.filter(target => target.mods.find(modData => modFilter.find(x => x === modData[0])));
                return _excludeImperviousAndOffline(modMatches);
            };

        const _excludeImpervious = (cards: GameEngine.ICardState[]) => {
            return cards.filter(x => !x.mods.find(y => y[0] === CardMod.Content.impervious.name));
        };

        export const _excludeOffline = (cards: GameEngine.ICardState[]) => {
            return cards.filter(x => !x.mods.find(y => y[0] === CardMod.Content.offline.name));
        };

        export const _excludeImperviousAndOffline = (cards: GameEngine.ICardState[]) => _excludeImpervious(_excludeOffline(cards));

        const _filterForFirewall = (cards: GameEngine.ICardState[]) => {
            return cards.filter(x => x.mods.find(y => y[0] === CardMod.Content.firewall.name));
        };
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
                const secDamage = GameEngineUtils.scaleByCpuMem(12, card.cpu);
                const bdChance = round(GameEngineUtils.scaleByCpuMem(20, card.mem, 'high') / 100, 2);
                const bdDamage = GameEngineUtils.scaleByCpuMem(6, card.cpu);

                super(
                    // Any extra data to serialize into scriptData[1:] as a 'memo' which can serve two purposes:
                    // 1) the client relies on the memo to display potential card effects in the UI instead calculating it independently
                    // 2) memo is passed back into the constructor during deserialization, useful for dynamic AI scripts
                    [secDamage, bdChance, bdDamage],

                    // Which cards are valid targets for this card; AI will typically .random()
                    TargetFinders.Opponents(),

                    // A composition of CardScriptParts that get executed when this card is played; this allows for
                    // composition effects such as "((damage and debuff) to target) AND (chance to stun neighbors)":
                    // The first part would use the Target resolver and Attack and ApplyMod parts
                    // The second part would use the Neighbors resolver and curry Stun part into _Chance part
                    [
                        {
                            // Given a chosen target, which actual targets these parts will execute on; this allows
                            // a card to, for example, deal damage to the neighbors of the specified target
                            targetResolver: TargetResolvers.Target,

                            // CardScriptParts to execute on the resolved targets
                            parts: [
                                CardScriptParts.SecDmg(secDamage),
                                CardScriptParts._Chance(bdChance,
                                    CardScriptParts.AddMod(
                                        new CardMod.Content.backdoor(bdDamage),
                                    )
                                ),
                            ],
                        }
                    ],
                );
            }
        }

        export class bd_exploit extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const damage = GameEngineUtils.scaleByCpuMem(6, card.cpu);
                const bdChance = round(GameEngineUtils.scaleByCpuMem(40, card.mem, 'more') / 100, 2);

                super(
                    [damage, bdChance],
                    (gameData: GameEngine.IGameData, card: GameEngine.ICardState) => [
                        ...TargetFinders.Opponents()(gameData, card),
                        ...TargetFinders._ModFilter<typeof CardMod.Content, 'backdoor'>(['backdoor'],
                            TargetFinders.Opponents(true))(gameData, card),
                    ],
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts._TargetHasMod<typeof CardMod.Content, 'backdoor'>('backdoor', mod => CardScriptParts.SecDmg(mod.stackingConfig.rank, true)),
                                CardScriptParts.Attack(damage),
                                CardScriptParts._Chance(bdChance,
                                    CardScriptParts.AddMod(
                                        new CardMod.Content.backdoor(damage),
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
                const secBonus = GameEngineUtils.scaleByCpuMem(10, card.cpu);

                super(
                    [secBonus],
                    TargetFinders.Any(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts.RaiseSec(secBonus),
                            ],
                        }
                    ],
                );
                this.cooldownMax = 1;
            }
        }

        export class bf_spam extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const damage = GameEngineUtils.scaleByCpuMem(6, card.cpu);

                super(
                    [damage],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts.Attack(damage),
                                CardScriptParts.Attack(damage),
                            ],
                        }
                    ]
                );
            }
        }

        export class bf_firewall extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const secBonus = GameEngineUtils.scaleByCpuMem(6, card.cpu);
                const modDuration = Math.ceil(card.mem / 2);

                super(
                    [secBonus, modDuration],
                    TargetFinders.Self,
                    [
                        {
                            targetResolver: TargetResolvers.Self,
                            parts: [
                                CardScriptParts.RaiseSec(secBonus),
                                CardScriptParts.AddMod(
                                    new CardMod.Content.firewall(modDuration),
                                ),
                            ],
                        }
                    ],
                );
                this.cooldownMax = 1;
            }
        }

        export class bf_overclock extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const damage = GameEngineUtils.scaleByCpuMem(17, card.cpu);
                const lagChance = round((100 - GameEngineUtils.scaleByCpuMem(30, card.mem)) / 100, 2);
                const lagDuration = 2;

                super(
                    [damage, lagChance, lagDuration],
                    CardScript.TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: CardScript.TargetResolvers.Target,
                            parts: [
                                CardScriptParts.Attack(damage),
                            ],
                        },
                        {
                            targetResolver: CardScript.TargetResolvers.Self,
                            parts: [
                                CardScriptParts._Chance(lagChance,
                                    CardScriptParts.AddMod(
                                        new CardMod.Content.lag(lagDuration),
                                    ),
                                ),
                            ],
                        }
                    ],
                );
            }
        }

        export class mw_freeware extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const minBonus = GameEngineUtils.scaleByCpuMem(6, card.cpu);
                const maxBonus = GameEngineUtils.scaleByCpuMem(12, card.cpu, 'more');

                super(
                    [minBonus, maxBonus],
                    TargetFinders.Any(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts.RaiseSec(randInt(minBonus, maxBonus)),
                            ],
                        }
                    ],
                );
                this.cooldownMax = 1;
            }
        }

        export class mw_redirect extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const tempSecBonus = GameEngineUtils.scaleByCpuMem(10, card.cpu);
                const duration = Math.ceil(card.mem / 2);

                super(
                    [tempSecBonus, duration],
                    TargetFinders.Allies(true),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts.AddMod(
                                    new CardMod.Content.secured(tempSecBonus, duration),
                                ),
                                CardScriptParts.AddMod(
                                    new CardMod.Content.firewall(duration),
                                ),
                            ],
                        }
                    ],
                );
                this.cooldownMax = 1;
            }
        }

        export class mw_worm extends CardScript {
            constructor(card: GameEngine.ICardState) {
                const minDamage = GameEngineUtils.scaleByCpuMem(7, card.cpu);
                const maxDamage = GameEngineUtils.scaleByCpuMem(13, card.cpu);

                super(
                    [minDamage, maxDamage],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts.Attack(randInt(minDamage, maxDamage)),
                            ],
                        }
                    ],
                );
            }
        }

        export class _attack extends CardScript {
            constructor(card: GameEngine.ICardState, difficulty: number, strength: 'weak' | 'normal' | 'strong' = 'normal', cooldown = 0) {
                let minDmg = 0;
                let maxDmg = 0;
                switch (strength) {
                    case 'weak':
                        minDmg = GameEngineUtils.scaleByCpuMem(6, card.cpu);
                        maxDmg = GameEngineUtils.scaleByCpuMem(8, card.cpu);
                        break;
                    case 'normal':
                        minDmg = GameEngineUtils.scaleByCpuMem(8, card.cpu);
                        maxDmg = GameEngineUtils.scaleByCpuMem(12, card.cpu);
                        break;
                    case 'strong':
                        minDmg = GameEngineUtils.scaleByCpuMem(11, card.cpu);
                        maxDmg = GameEngineUtils.scaleByCpuMem(15, card.cpu);
                        break;
                }
                minDmg = GameEngineUtils.scaleByDifficulty(minDmg, difficulty);
                maxDmg = GameEngineUtils.scaleByDifficulty(maxDmg, difficulty);

                super(
                    [difficulty, strength, cooldown, minDmg, maxDmg],
                    TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts.Attack(randInt(minDmg, maxDmg)),
                            ],
                        }
                    ],
                );
                this.cooldownMax = cooldown;
            }
        }

        export class _defend extends CardScript {
            constructor(card: GameEngine.ICardState, difficulty: number, strength: 'weak' | 'normal' | 'strong' = 'normal', cooldown = 0) {
                let minBonus = 0;
                let maxBonus = 0;
                switch (strength) {
                    case 'weak':
                        minBonus = GameEngineUtils.scaleByCpuMem(4, card.cpu);
                        maxBonus = GameEngineUtils.scaleByCpuMem(6, card.cpu);
                        break;
                    case 'normal':
                        minBonus = GameEngineUtils.scaleByCpuMem(6, card.cpu);
                        maxBonus = GameEngineUtils.scaleByCpuMem(8, card.cpu);
                        break;
                    case 'strong':
                        minBonus = GameEngineUtils.scaleByCpuMem(8, card.cpu);
                        maxBonus = GameEngineUtils.scaleByCpuMem(11, card.cpu);
                        break;
                }
                minBonus = GameEngineUtils.scaleByDifficulty(minBonus, difficulty);
                maxBonus = GameEngineUtils.scaleByDifficulty(maxBonus, difficulty);

                super(
                    [difficulty, strength, cooldown, minBonus, maxBonus],
                    TargetFinders.Allies(),
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts.RaiseSec(randInt(minBonus, maxBonus)),
                            ],
                        }
                    ],
                );
                this.cooldownMax = cooldown;
            }
        }

        export class _firewallSelf extends CardScript {
            constructor(_card: GameEngine.ICardState, duration = 1, cooldown = 0, startingCooldown = 0) {
                super(
                    [duration, cooldown],
                    TargetFinders.Self,
                    [
                        {
                            targetResolver: TargetResolvers.Target,
                            parts: [
                                CardScriptParts.AddMod(
                                    new CardMod.Content.firewall(duration + 1),
                                ),
                            ],
                        }
                    ],
                );
                this.cooldownCur = startingCooldown;
                this.cooldownMax = cooldown;
            }
        }

        export class _spawn extends CardScript {
            constructor(_card: GameEngine.ICardState, enemyClass: string, spawnPosition: Parameters<typeof CardScriptParts['SpawnEnemy']>[1] = 'relLeft', generateIntent = false, cooldown = 0) {
                super(
                    [enemyClass, spawnPosition, generateIntent, cooldown],
                    TargetFinders.Self,
                    [
                        {
                            targetResolver: TargetResolvers.Self,
                            parts: [
                                CardScriptParts.SpawnEnemy(enemyClass, spawnPosition, generateIntent),
                            ],
                        }
                    ],
                );
                this.cooldownMax = cooldown;
            }
        }
    }
    (Content as Record<CoreScriptNames, ScriptConstructor>);
}