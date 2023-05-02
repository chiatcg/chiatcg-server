import { IPlayerPushProvider } from '../dependencies';
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

    onSecDamaged?(deps: CardMod.ICardModDeps, damage: number, attacker: GameEngine.ICardState): { secDmgBonus: number } | void;
    onDamageSec?(deps: CardMod.ICardModDeps, baseDmg: number): { secDmgBonus: number } | void;

    onInit?(deps: CardMod.ICardModDeps): void;
    onRemove?(deps: CardMod.ICardModDeps): void;
    onDestroy?(deps: CardMod.ICardModDeps): void;
    onGameStart?(deps: CardMod.ICardModDeps): void;
    onStack?(deps: CardMod.ICardModDeps, stackDelta: number): void;
    onTurnStart?(deps: CardMod.ICardModDeps): void;
    onTurnEnd?(deps: CardMod.ICardModDeps): void;

    serialize() {
        const stackingData = CardMod.makeStackingData(this.stackingConfig);
        const modData = [this.modName, stackingData] as CardMod.ModData;
        (this.duration >= 0) && (modData.push(CardMod.makeDurationData(this.duration)));
        this._extraModData && modData.push(...this._extraModData);
        return modData;
    }

    static addMod(gameData: GameEngine.IGameData, card: GameEngine.ICardState, mod: CardMod, broadcast: IPlayerPushProvider.IPushMessage[], contextCard?: GameEngine.ICardState) {
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
                    this.removeMod(gameData, card, existingModData, broadcast, contextCard);
                    if (card.isRemoved) return;
                }
                card.mods.push(modData);
                break;
            }

            case CardMod.StackingBehavior.replace: {
                const existingModData = card.mods.find(x => x[0] === mod.modName);
                if (existingModData) {
                    this.removeMod(gameData, card, existingModData, broadcast, contextCard);
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
                    broadcast.push({
                        type: 'modChanged',
                        cardId: card.id,
                        modData: existingModData,
                    });
                    this.trigger('onStack', existingModData, { broadcast, gameData, sourceCard: card, contextCard }, mod.stackingConfig.stackCount);
                    return;
                }
                card.mods.push(modData);
                break;
            }
        }

        const durationData = this.findDurationData(modData);
        durationData && durationData[1]++;

        broadcast.push({
            type: 'modAdded',
            cardId: card.id,
            modData,
        });
        this.trigger('onInit', modData, { broadcast, gameData, sourceCard: card, contextCard });
    }

    static areEqual(left: CardMod.ModData, right: CardMod.ModData) {
        // Caveat: could collide since join() flattens array but highly unlikely
        return left.join('') === right.join('');
    }

    static deserialize(modData: CardMod.ModData) {
        const modCtor = (CardMod.Content as CardMod.ModLibrary)[modData[0]];
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

    static removeMod(gameData: GameEngine.IGameData, card: GameEngine.ICardState, modData: CardMod.ModData, broadcast: IPlayerPushProvider.IPushMessage[], contextCard?: GameEngine.ICardState) {
        broadcast.push({
            type: 'modRemoved',
            cardId: card.id,
            modData,
        });

        if (!card.mods.find(x => this.areEqual(x, modData))) {
            throw new Error('mod not found');
        }

        this.trigger('onRemove', modData, { broadcast, gameData, sourceCard: card, contextCard });
        card.mods.findAndRemoveFirst(x => this.areEqual(x, modData));
    }

    static removeModByName<T extends CardMod.ModLibrary, K extends keyof T>(gameData: GameEngine.IGameData, card: GameEngine.ICardState, modName: K, broadcast: IPlayerPushProvider.IPushMessage[], contextCard?: GameEngine.ICardState) {
        const mod = card.mods.find(x => x[0] === modName);
        mod && this.removeMod(gameData, card, mod, broadcast, contextCard);
    }

    static trigger<T extends CardMod.ModEvent>(ev: T, modData: CardMod.ModData, ...args: Parameters<NonNullable<CardMod[typeof ev]>>) {
        const deps = args[0];
        const modDataFromCard = deps.sourceCard.mods.find(x => this.areEqual(x, modData));
        if (!modDataFromCard) {
            throw new Error(`card [${deps.sourceCard.id}] does not have mod [${modData.join()}], mods are ${deps.sourceCard.mods.join('|')}`);
        }

        const mod = this.deserialize(modDataFromCard);
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

                    deps.broadcast.push({
                        type: 'modChanged',
                        cardId: deps.sourceCard.id,
                        modData: modData,
                    });
                } else {
                    this.removeMod(deps.gameData, deps.sourceCard, modData, deps.broadcast);
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
        gameData: GameEngine.IGameData;
        sourceCard: GameEngine.ICardState;
        broadcast: IPlayerPushProvider.IPushMessage[];

        contextCard?: GameEngine.ICardState;
    }

    export namespace Content {
        // Defines a card modifier - the class name is treated as the mod name
        export class exploited extends CardMod {
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

            // Define card modifiers behavior by hooking into a game event.
            override onSecDamaged(_deps: ICardModDeps, _damage: number, _attacker: GameEngine.ICardState) {
                return { secDmgBonus: this.stackingConfig.rank };
            }
        }

        export class firewall extends CardMod {
            constructor(override duration: number) {
                super(arguments);
            }

            override onInit(deps: ICardModDeps) {
                if (GameEngineUtils.isEnemyCard(deps.sourceCard)) {
                    return;
                }

                GameEngineUtils.revalidateIntents(deps.gameData, true, deps.broadcast);
            }
        }

        export class secured extends CardMod {
            constructor(public tempSecBonus: number, override duration: number) {
                super(arguments);
            }

            override onInit(deps: ICardModDeps) {
                GameEngineUtils.changeSec(deps.sourceCard, this.tempSecBonus, deps.broadcast);
            }

            override onTurnStart(deps: ICardModDeps) {
                GameEngineUtils.changeSec(deps.sourceCard, -this.tempSecBonus, deps.broadcast);
            }
        }

        export class winOnDeath extends CardMod {
            override onDestroy(deps: ICardModDeps) {
                deps.gameData.state = 'players_won';
            }
        }

        export class _standardAi extends CardMod {
            override onTurnStart(deps: ICardModDeps) {
                if (!GameEngineUtils.isEnemyCard(deps.sourceCard)) {
                    throw new Error('not an enemy card');
                }
                GameEngineUtils.generateIntent(deps.gameData, deps.sourceCard, deps.broadcast);
            }

            override onTurnEnd(deps: ICardModDeps) {
                if (!GameEngineUtils.isEnemyCard(deps.sourceCard)) {
                    throw new Error('not an enemy card');
                }
                GameEngineUtils.executeIntent(deps.gameData, deps.sourceCard, deps.broadcast);
            }
        }

        export class _yieldScript extends CardMod {
            constructor(
                public scriptData: CardScript.ScriptData,
                override duration: number,
            ) {
                super(arguments);
            }

            override onRemove(deps: ICardModDeps) {
                GameEngineUtils.addScript(deps.gameData, deps.sourceCard, this.scriptData, deps.broadcast);
            }
        }
    }
}
