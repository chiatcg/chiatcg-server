import { ModName } from '../appraise';
import { IPlayerPushProvider } from '../dependencies';
import { CardScriptComp } from './card-script-comp';
import { CardScript } from './card-scripts';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

export abstract class CardMod {
    static deserialize(modData: CardMod.ModData) {
        const modCtor = (CardMod as Record<ModName, { new(...args: any[]): CardMod }>)[modData[0]];
        if (!modCtor) {
            throw new Error('cannot find mod: ' + modData.join());
        }
        return new modCtor(...modData.slice(1));
    }


    private _durationData: readonly ['$duration', number];

    modData: CardMod.ModData;

    constructor(
        extraModData?: IArguments,
        public duration = 0,
    ) {
        this.modData = [this.constructor.name as ModName, ...(extraModData || [])];
        const durationData = this.modData.find((x): x is ['$duration', number] => Array.isArray(x) && x[0] === '$duration');
        if (durationData) {
            this._durationData = durationData;
            this.duration = this._durationData[1];
        } else {
            this._durationData = ['$duration', duration];
            this.modData.push(this._durationData);
        }
    }

    equals(other: CardMod) {
        return this.equalsData(other.modData);
    }

    equalsData(other: CardMod.ModData, strict = false) {
        // Caveat: could collide since join() flattens array but highly unlikely
        return strict ? (this.modData.join('') === other.join('')) : (this.modData[0] === other[0]);
    }

    onAttacked?(deps: CardMod.ICardModDeps): any;

    onInit?(deps: CardMod.ICardModDeps): any;
    onRemove?(deps: CardMod.ICardModDeps): any;
    onDestroy?(deps: CardMod.ICardModDeps): any;
    onGameStart?(deps: CardMod.ICardModDeps): any;
    onTurnStart?(deps: CardMod.ICardModDeps): any;
    onTurnEnd?(deps: CardMod.ICardModDeps): any;

    trigger(ev: CardMod.ModEvent, deps: CardMod.ICardModDeps) {
        const evnt = this[ev];
        evnt && evnt.call(this, deps);

        if (ev === 'onTurnEnd') {
            if (this.duration > 0) {
                if (!deps.sourceCard.mods.findAndRemoveFirst(x => this.equalsData(x))) {
                    // origOTE must have removed this mod already, skip...
                    return;
                }

                if (this.duration > 1) {
                    this.modData.removeFirst(this._durationData);
                    const newDurationData = ['$duration', this.duration - 1] as const;
                    const newMod: CardMod.ModData = [...this.modData, newDurationData];
                    this.modData.push(this._durationData);

                    deps.sourceCard.mods.push(newMod);
                    deps.broadcast.push({
                        type: 'modTick',
                        cardId: deps.sourceCard.id,
                        oldMod: this.modData,
                        mod: newMod,
                    });

                    this.duration = newDurationData[1];
                    this.modData = newMod;
                    this._durationData = newDurationData
                } else {
                    this.onRemove && this.onRemove(deps);
                    deps.broadcast.push({
                        type: 'modExpired',
                        mod: this.modData,
                    });
                }
            }
        }
    }
}
export namespace CardMod {
    export type ModData = [ModName, ...unknown[]];
    export type EnemyModData = unknown[];
    export type ModEvent = Exclude<keyof CardMod, 'duration' | 'modData' | 'trigger' | 'equals' | 'equalsData'>;

    export interface ICardModDeps {
        gameData: GameEngine.IGameData;
        sourceCard: GameEngine.ICardState;
        broadcast: IPlayerPushProvider.IPushMessage[];

        contextCard?: GameEngine.ICardState;
    }

    // Defines a card modifier - the class name must match a mod name in a appraised card
    export class backdoor extends CardMod {
        constructor(public damage: number) {
            // Any extra data to serialize into this.modData as a 'memo' which can serve two purposes:
            // 1) the client relies on the memo to display modifier effects in the UI instead calculating it independently
            // 2) memo is passed back into the constructor during deserialization, useful for dynamic AI modifiers,
            //      see _standardAi below for example
            super(arguments);
        }

        override onAttacked(deps: CardMod.ICardModDeps) {
            if (!deps.contextCard || !GameEngineUtils.isPlayerCard(deps.contextCard) || deps.contextCard.card.faction !== 'blue') {
                return;
            }

            CardScriptComp.Attack(this.damage, false)(deps.gameData, deps.sourceCard, deps.sourceCard, deps.broadcast);
        }
    }

    export class feedback extends CardMod {
        constructor(public damage: number) {
            super(arguments);
        }

        override onAttacked(deps: CardMod.ICardModDeps) {
            CardScriptComp.Attack(this.damage, false)(deps.gameData, deps.sourceCard, deps.sourceCard, deps.broadcast);
        }
    }

    export class winOnDeath extends CardMod {
        override onDestroy(deps: ICardModDeps) {
            deps.gameData.state = 'players_won';
        }
    }

    export class scriptCooldown extends CardMod {
        constructor(duration: number, public scriptData: CardScript.ScriptData) {
            super(arguments, duration);
        }

        override onRemove(deps: ICardModDeps) {
            deps.sourceCard.scripts.push(this.scriptData);
        }
    }

    export class freeze extends CardMod {
        constructor(duration: number) {
            super(arguments, duration);
        }

        override onInit(deps: ICardModDeps) {
            if (GameEngineUtils.isEnemyCard(deps.sourceCard)) {
                deps.sourceCard.intent = undefined;
            }
        }

        override onTurnStart(deps: ICardModDeps) {
            if (GameEngineUtils.isEnemyCard(deps.sourceCard)) {
                deps.sourceCard.intent = undefined;
            } else {
                deps.sourceCard.isUsed = true;
            }
        }
    }

    export class stun extends CardMod {
        constructor(duration: number) {
            super(arguments, duration);
        }

        override onInit(deps: ICardModDeps) {
            if (GameEngineUtils.isEnemyCard(deps.sourceCard)) {
                deps.sourceCard.intent = undefined;
            }
        }

        override onTurnStart(deps: ICardModDeps) {
            if (GameEngineUtils.isEnemyCard(deps.sourceCard)) {
                deps.sourceCard.intent = undefined;
            } else {
                deps.sourceCard.isUsed = true;
            }
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
}
