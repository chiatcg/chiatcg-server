import { CardScript } from './card-scripts';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

export abstract class CardMod {
    duration = -1;
    stackingConfig: Parameters<typeof CardMod['makeStackingData']>[0] = { behavior: CardMod.StackingBehavior.neverReplace };

    readonly modName: string;

    constructor(
        private _extraModData?: IArguments,
    ) {
        this.modName = this.constructor.name;
    }

    onSecDamageIn?(deps: CardMod.ICardModDeps, damage: number, attacker: GameEngine.ICardState): { secDmgBonus: number } | void;
    onSecDamageOut?(deps: CardMod.ICardModDeps, baseDmg: number): { secDmgBonus: number } | void;

    onMemDmgIn?(deps: CardMod.ICardModDeps, memDmg: number): void;
    onMemDmgOut?(deps: CardMod.ICardModDeps, memDmg: number): void;

    onInitMod?(deps: CardMod.ICardModDeps): void;
    onRemoveMod?(deps: CardMod.ICardModDeps): void;
    onCardDestroyed?(deps: CardMod.ICardModDeps): void;
    onStackMod?(deps: CardMod.ICardModDeps, stackDelta: number): void;
    onTurnStart?(deps: CardMod.ICardModDeps): void;
    onTurnEnd?(deps: CardMod.ICardModDeps): void;
    onEnemyDestroyed?(deps: CardMod.ICardModDeps): void;

    serialize() {
        const stackingData = CardMod.makeStackingData(this.stackingConfig);
        const modData = [this.modName, stackingData] as CardMod.ModData;
        (this.duration >= 0) && (modData.push(CardMod.makeDurationData(this.duration)));
        this._extraModData && modData.push(...this._extraModData);
        return modData;
    }

    static addMod(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, mod: CardMod, contextCard?: GameEngine.ICardState) {
        const modData = mod.serialize();

        switch (mod.stackingConfig.behavior) {
            case CardMod.StackingBehavior.append: {
                card.mods.push(modData);
                break;
            }

            case CardMod.StackingBehavior.neverReplace: {
                const existingModData = card.mods.find(x => x[0] === mod.modName);
                if (existingModData) return;

                card.mods.push(modData);
                break;
            }

            case CardMod.StackingBehavior.ranked: {
                const existingModData = card.mods.find(x => x[0] === mod.modName);
                if (existingModData) {
                    const existingStackingData = existingModData[1] as CardMod.RankedStackingData;
                    if (existingStackingData[2] >= mod.stackingConfig.rank) {
                        return;
                    }
                    this.removeMod(engine, card, existingModData, contextCard);
                    if (card.isRemoved) return;
                }
                card.mods.push(modData);
                break;
            }

            case CardMod.StackingBehavior.replace: {
                const existingModData = card.mods.find(x => x[0] === mod.modName);
                if (existingModData) {
                    this.removeMod(engine, card, existingModData, contextCard);
                    if (card.isRemoved) return;
                }
                card.mods.push(modData);
                break;
            }

            case CardMod.StackingBehavior.stack: {
                const existingModData = card.mods.find(x => x[0] === mod.modName);
                if (existingModData) {
                    const existingStackingData = existingModData[1] as CardMod.RankedStackingData;
                    existingStackingData && (existingStackingData[2] += mod.stackingConfig.stackCount);
                    engine.broadcast.push({
                        type: 'modStackChanged',
                        cardId: card.id,
                        modData: existingModData,
                        stackDelta: mod.stackingConfig.stackCount,
                        newStackCount: existingStackingData[2],
                    });
                    this.trigger('onStackMod', existingModData, { engine, sourceCard: card, contextCard }, mod.stackingConfig.stackCount);
                    return;
                }
                card.mods.push(modData);
                break;
            }
        }

        engine.broadcast.push({
            type: 'modAdded',
            cardId: card.id,
            modData,
        });
        this.trigger('onInitMod', modData, { engine, sourceCard: card, contextCard });
    }

    static areEqual(left: CardMod.ModData, right: CardMod.ModData) {
        // Caveat: could collide since join() flattens array but highly unlikely
        return left.join('') === right.join('');
    }

    static deserialize(engine: GameEngine.IGameEngine, modData: CardMod.ModData) {
        const modCtor = engine.ruleset.cardMods?.[modData[0]];
        if (!modCtor) throw new Error('mod not found: ' + modData.join());

        const durationData = this.findDurationData(modData);
        const mod = new modCtor(...modData.slice(durationData ? 3 : 2));
        durationData && (mod.duration = durationData[1]);

        const stackingData = modData[1];
        mod.stackingConfig.behavior = stackingData[1];
        switch (stackingData[1]) {
            case CardMod.StackingBehavior.ranked:
                (mod.stackingConfig as any).rank = stackingData[2];
                break;
            case CardMod.StackingBehavior.stack:
                (mod.stackingConfig as any).stackCount = stackingData[2];
                break;
        }
        return mod;
    }

    static findDurationData(modData: CardMod.ModData) {
        const maybeDurationData = modData[2];
        return (Array.isArray(maybeDurationData) && maybeDurationData[0] === '$duration') ? (modData[2] as CardMod.DurationData) : undefined;
    }

    static findModOfType(card: GameEngine.ICardState, modType: CardMod.ModConstructor) {
        return card.mods.find(x => x[0] === modType.name);
    }

    static getStackCount(modData: CardMod.ModData) {
        return modData[1][1] === CardMod.StackingBehavior.stack ? modData[1][2] : 0;
    }

    static makeDurationData(duration: number): CardMod.DurationData {
        return ['$duration', duration];
    }

    static makeStackingData(
        stackConfig: { behavior: CardMod.StackingBehavior.append }
            | { behavior: CardMod.StackingBehavior.neverReplace }
            | { behavior: CardMod.StackingBehavior.ranked, rank: number }
            | { behavior: CardMod.StackingBehavior.replace }
            | { behavior: CardMod.StackingBehavior.stack, stackCount: number }
    ) {
        const stackingData = ['$stack', stackConfig.behavior];
        (stackConfig.behavior === CardMod.StackingBehavior.ranked) && stackingData.push(stackConfig.rank);
        (stackConfig.behavior === CardMod.StackingBehavior.stack) && stackingData.push(stackConfig.stackCount);
        return stackingData as CardMod.StackingData;
    }

    static removeMod(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, modData: CardMod.ModData, contextCard?: GameEngine.ICardState) {
        engine.broadcast.push({
            type: 'modRemoved',
            cardId: card.id,
            modData,
        });

        if (!card.mods.find(x => this.areEqual(x, modData))) {
            throw new Error('mod not found');
        }

        this.trigger('onRemoveMod', modData, { engine, sourceCard: card, contextCard });
        card.mods.findAndRemoveFirst(x => this.areEqual(x, modData));
    }

    static removeModByName<T extends CardMod.ModLibrary, K extends keyof T>(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, modName: K, contextCard?: GameEngine.ICardState) {
        const mod = card.mods.find(x => x[0] === modName);
        mod && this.removeMod(engine, card, mod, contextCard);
    }

    static trigger<T extends CardMod.ModEvent>(ev: T, modData: CardMod.ModData, ...args: Parameters<NonNullable<CardMod[typeof ev]>>) {
        const deps = args[0];
        const modDataFromCard = deps.sourceCard.mods.find(x => this.areEqual(x, modData));
        if (!modDataFromCard) {
            throw new Error(`card [${deps.sourceCard.id}] does not have mod [${modData.join()}], mods are ${deps.sourceCard.mods.join('|')}`);
        }

        const mod = this.deserialize(deps.engine, modDataFromCard);
        const evnt = mod[ev];
        const evntRetVal = evnt ? (evnt as any).apply(mod, args) : undefined;
        if (deps.sourceCard.isRemoved) {
            return;
        }

        if (ev === 'onTurnStart') {
            const durationData = this.findDurationData(modDataFromCard);
            if (durationData) {
                if (durationData[1] > 1) {
                    durationData[1]--;

                    deps.engine.broadcast.push({
                        type: 'modDurationChanged',
                        cardId: deps.sourceCard.id,
                        modData: modData,
                        newDuration: durationData[1],
                    });
                } else {
                    this.removeMod(deps.engine, deps.sourceCard, modData);
                }
            }
        }
        return evntRetVal as ReturnType<NonNullable<CardMod[T]>> | undefined;
    }
}
export namespace CardMod {
    export type ModData = [string, StackingData, ...unknown[],];
    export type DurationData = ['$duration', number];
    export type EnemyModData = unknown[];
    export type ModConstructor = TypeConstructor<CardMod>;
    export type ModEvent = KeyOfFilteredByValueType<CardMod, ((deps: ICardModDeps, ...args: any) => any) | undefined> & StringsStartingWith<keyof CardMod, 'on'>;
    export type ModLibrary = Record<string, ModConstructor>;

    export type AppendStackingData = ['$stack', StackingBehavior.append];
    export type NeverReplaceStackingData = ['$stack', StackingBehavior.neverReplace];
    export type RankedStackingData = ['$stack', StackingBehavior.ranked, number];
    export type ReplaceStackingData = ['$stack', StackingBehavior.replace];
    export type StackStackingData = ['$stack', StackingBehavior.stack, number];
    export type StackingData = AppendStackingData | NeverReplaceStackingData | RankedStackingData | ReplaceStackingData | StackStackingData;

    export enum StackingBehavior {
        append,
        neverReplace,
        ranked,
        replace,
        stack,
    }

    export interface ICardModDeps {
        engine: GameEngine.IGameEngine;
        sourceCard: GameEngine.ICardState;
        contextCard?: GameEngine.ICardState;
    }

    export namespace Content {
        // Defines a card modifier - the class name is treated as the mod name
        export class backdoor extends CardMod {
            override stackingConfig = {
                behavior: CardMod.StackingBehavior.ranked as const,
                rank: 0,
            };

            constructor(public damage: number) {
                // Any extra data to serialize into this.modData as a 'memo' which can serve two purposes:
                // 1) the client relies on the memo to display modifier effects in the UI instead calculating it independently
                // 2) memo is passed back into the constructor during deserialization, useful for dynamic AI modifiers,
                //      see _standardAi below for example
                super(arguments);

                this.stackingConfig.rank = damage;
            }
        }

        export class diagnostics extends CardMod {
            override stackingConfig = {
                behavior: CardMod.StackingBehavior.stack as const,
                stackCount: 0,
            };

            constructor(public secBonus: number, override duration: number) {
                super(arguments);

                this.stackingConfig.stackCount = secBonus;
            }

            override onTurnEnd(deps: ICardModDeps): void {
                GameEngineUtils.changeSec(deps.engine, deps.sourceCard, this.stackingConfig.stackCount, false);
            }
        }

        export class firewall extends CardMod {
            override stackingConfig = {
                behavior: CardMod.StackingBehavior.ranked as const,
                rank: 0,
            };

            constructor(override duration: number) {
                super(arguments);
                this.stackingConfig.rank = duration;
            }

            override onInitMod(deps: ICardModDeps) {
                if (GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    return;
                }

                GameEngineUtils.revalidateIntents(deps.engine, true);
            }
        }

        export class impervious extends CardMod {
            constructor(override duration = -1) {
                super(arguments);
            }

            override onSecDamageIn(_deps: ICardModDeps, _damage: number, _attacker: GameEngine.ICardState) {
                return {
                    secDmgBonus: -9999,
                };
            }
        }

        export class lag extends CardMod {
            constructor(override duration: number) {
                super(arguments);
            }

            override onInitMod(deps: CardMod.ICardModDeps) {
                if (GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    GameEngineUtils.clearIntent(deps.engine, deps.sourceCard);
                } else {
                    GameEngineUtils.changeCardIsUsed(deps.engine, deps.sourceCard, true);
                }
            }

            override onTurnStart(deps: CardMod.ICardModDeps) {
                if (GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    GameEngineUtils.clearIntent(deps.engine, deps.sourceCard);
                } else {
                    GameEngineUtils.changeCardIsUsed(deps.engine, deps.sourceCard, true);
                }
            }

            override onRemoveMod(deps: ICardModDeps): void {
                if (GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    GameEngineUtils.generateIntent(deps.engine, deps.sourceCard);
                } else {
                    GameEngineUtils.changeCardIsUsed(deps.engine, deps.sourceCard, false);
                }
            }
        }

        export class offline extends CardMod {
            constructor(override duration: number) {
                super(arguments);
            }

            override onInitMod(deps: CardMod.ICardModDeps) {
                if (GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    GameEngineUtils.clearIntent(deps.engine, deps.sourceCard);
                }
                GameEngineUtils.revalidateIntents(deps.engine, GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard));
            }

            override onTurnStart(deps: CardMod.ICardModDeps) {
                if (GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    GameEngineUtils.clearIntent(deps.engine, deps.sourceCard);
                } else {
                    GameEngineUtils.changeCardIsUsed(deps.engine, deps.sourceCard, true);
                }
            }

            override onRemoveMod(deps: ICardModDeps): void {
                if (GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    GameEngineUtils.generateIntent(deps.engine, deps.sourceCard);
                } else {
                    GameEngineUtils.changeCardIsUsed(deps.engine, deps.sourceCard, false);
                }
            }
        }

        export class secured extends CardMod {
            override stackingConfig = {
                behavior: CardMod.StackingBehavior.stack as const,
                stackCount: 0,
            };

            constructor(public tempSecBonus: number, override duration: number) {
                super(arguments);
                this.stackingConfig.stackCount = tempSecBonus;
            }

            override onInitMod(deps: ICardModDeps) {
                GameEngineUtils.changeSec(deps.engine, deps.sourceCard, this.stackingConfig.stackCount, false);
            }

            override onStackMod(deps: ICardModDeps, stackDelta: number): void {
                GameEngineUtils.changeSec(deps.engine, deps.sourceCard, stackDelta, false);
            }

            override onRemoveMod(deps: ICardModDeps) {
                GameEngineUtils.changeSec(deps.engine, deps.sourceCard, -this.stackingConfig.stackCount, true);
            }
        }

        export class _waveBonus_extraMove extends CardMod {
            override onInitMod(deps: ICardModDeps): void {
                const player = GameEngineUtils.findPlayerByCardId(deps.engine.gameData, deps.sourceCard.id);
                player.movesPerTurn++;
                player.movesLeft = player.movesPerTurn;
                deps.engine.broadcast.push({
                    type: 'movesPerTurnsChange',
                    playerId: player.id,
                    newMovesLeft: player.movesLeft,
                    newMovesPerTurn: player.movesPerTurn,
                });
            }
        }

        export class _winOnDeath extends CardMod {
            override onCardDestroyed(deps: ICardModDeps) {
                const player = deps.contextCard ? GameEngineUtils.findPlayerByCardIdMaybe(deps.engine.gameData, deps.contextCard.id) : null;
                player && player.stats.kills++;
                deps.engine.onWinGame();
                player && player.stats.kills--;
            }
        }

        export class _standardAi extends CardMod {
            override onTurnStart(deps: ICardModDeps) {
                if (!GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    throw new Error('not an enemy card');
                }
                GameEngineUtils.generateIntent(deps.engine, deps.sourceCard);
            }

            override onTurnEnd(deps: ICardModDeps) {
                if (!GameEngineUtils.isEnemyCard(deps.engine.gameData, deps.sourceCard)) {
                    throw new Error('not an enemy card');
                }
                GameEngineUtils.executeIntent(deps.engine, deps.sourceCard);
            }
        }

        export class _yieldScript extends CardMod {
            constructor(
                public scriptData: CardScript.ScriptData,
                override duration: number,
            ) {
                super(arguments);
            }

            override onRemoveMod(deps: ICardModDeps) {
                CardScript.addScript(deps.engine, deps.sourceCard, this.scriptData);
            }
        }

        export class _waveTrigger extends CardMod {
            constructor(
                public rulesetIds: string[],
                override duration = -1,
            ) {
                super(arguments);
            }

            override onInitMod(deps: ICardModDeps): void {
                deps.engine.gameData.difficulty < 3 && GameEngineUtils.changeSec(deps.engine, deps.sourceCard, 25, true);
            }

            override onCardDestroyed(deps: ICardModDeps) {
                deps.engine.onNextWave(this.rulesetIds.random());
                deps.contextCard && CardMod.addMod(deps.engine, deps.contextCard, new _waveBonus_extraMove());
            }

            override onRemoveMod(deps: ICardModDeps): void {
                CardMod.addMod(deps.engine, deps.sourceCard, new _winOnDeath());
            }
        }
    }
}
