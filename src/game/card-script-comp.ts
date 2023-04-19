import { ModName } from '../appraise';
import { IPlayerPushProvider } from '../dependencies';
import { CardMod } from './card-mods';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

export namespace CardScriptComp {
    export interface ICardScriptComp {
        (gameData: GameEngine.IGameData, sourceCard: GameEngine.ICardState, targetCard: GameEngine.ICardState, broadcast: IPlayerPushProvider.IPushMessage[]): void;
    }

    export const _Chance = (chance: number, curriedComp: ICardScriptComp): ICardScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            if (Math.random() < chance) {
                curriedComp(gameData, sourceCard, targetCard, broadcast);
            }
        };

    export const _TargetHasMod = (modName: ModName, curriedComp: ICardScriptComp): ICardScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            if (targetCard.mods.find(x => x[0] === modName)) {
                curriedComp(gameData, sourceCard, targetCard, broadcast);
            }
        };

    export const ApplyMod = (modData: CardMod.ModData, allowDuplicate = false): ICardScriptComp =>
        (_gameData, _sourceCard, targetCard, broadcast) => {
            if (!allowDuplicate) {
                if (targetCard.mods.find(x => x[0] === modData[0])) {
                    return;
                }
            }

            targetCard.mods.push(modData);
            broadcast.push({
                type: 'modApplied',
                cardId: targetCard.id,
                mod: modData,
            });
        };

    export const Attack = (damage: number, triggerMods: boolean): ICardScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            triggerMods && GameEngineUtils.triggerMods(gameData, targetCard, 'onAttacked', broadcast, sourceCard);
            const doesMemDamage = damage > targetCard.sec;

            if (doesMemDamage) {
                targetCard.sec = 0;
            } else {
                targetCard.sec = targetCard.sec - damage;
            }

            broadcast.push({
                type: 'cardSecChange',
                cardId: targetCard.id,
                delta: damage,
                newSec: targetCard.sec,
            });

            if (doesMemDamage) {
                MemDmg(1)(gameData, sourceCard, targetCard, broadcast);
            }
        };

    export const MemDmg = (memDmg: number): ICardScriptComp =>
        (gameData, _sourceCard, targetCard, broadcast) => {
            targetCard.mem -= memDmg;
            broadcast.push({
                type: 'cardMemChange',
                cardId: targetCard.id,
                delta: memDmg,
                newMem: targetCard.mem
            });

            if (targetCard.mem <= 0) {
                GameEngineUtils.removeCard(gameData, targetCard, broadcast);
            }
        };

    export const RaiseSec = (secBonus: number): ICardScriptComp =>
        (_gameData, _sourceCard, targetCard, broadcast) => {
            targetCard.sec += secBonus;
            broadcast.push({
                type: 'cardSecChange',
                cardId: targetCard.id,
                delta: secBonus,
                newSec: targetCard.sec,
            });
        };

    export const RedirectIntentRandom: ICardScriptComp =
        (gameData, _sourceCard, targetCard, broadcast) => {
            if (!GameEngineUtils.isEnemyCard(targetCard) || !targetCard.intent) {
                return;
            }

            targetCard.intent.targetCardId = [...GameEngineUtils.getEnemyIds(gameData), ...GameEngineUtils.getPlayerCardIds(gameData)].random();

            broadcast.push({
                type: 'enemyIntent',
                enemyId: targetCard.id,
                intent: targetCard.intent,
            });
        };
}