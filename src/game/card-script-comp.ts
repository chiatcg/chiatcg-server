import { IPlayerPushProvider } from '../dependencies';
import { CardMod } from './card-mods';
import { CardScript } from './card-scripts';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

export namespace CardScriptComp {
    export interface IScriptComp {
        (gameData: GameEngine.IGameData, sourceCard: GameEngine.ICardState, targetCard: GameEngine.ICardState, broadcast: IPlayerPushProvider.IPushMessage[]): void;
    }

    export const _Chance = (chance: number, curriedComp: IScriptComp): IScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            if (Math.random() < chance) {
                curriedComp(gameData, sourceCard, targetCard, broadcast);
            }
        };

    export const _TargetHasMod = <T extends CardMod.ModLibrary, K extends keyof T>(modName: K, curry: (mod: InstanceType<T[K]>) => IScriptComp): IScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            const mod = targetCard.mods.find(x => x[0] === modName);
            if (mod) {
                curry(CardMod.deserialize(mod) as InstanceType<T[K]>)(gameData, sourceCard, targetCard, broadcast);
            }
        };

    export const AddMod = (mod: CardMod): IScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            CardMod.addMod(gameData, targetCard, mod, broadcast, sourceCard);
        };

    export const Attack = (damage: number, triggerOnAttacked: boolean): IScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            const secExceeded = SecDmg(damage, triggerOnAttacked)(gameData, sourceCard, targetCard, broadcast) as unknown;
            if (secExceeded) {
                MemDmg(1)(gameData, sourceCard, targetCard, broadcast);
            }
        };

    export const SecDmg = (secDmg: number, triggerOnDamaged: boolean): IScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            let resolvedDamage = secDmg;
            resolvedDamage += GameEngineUtils.triggerMods('onDamageSec', { broadcast, gameData, sourceCard, contextCard: targetCard }, resolvedDamage)
                .reduce((sum, x) => sum + (!!x ? x.secDmgBonus : 0), 0);

            if (triggerOnDamaged) {
                resolvedDamage += GameEngineUtils.triggerMods('onSecDamaged', { broadcast, gameData, sourceCard: targetCard, contextCard: sourceCard }, resolvedDamage, sourceCard)
                    .reduce((sum, x) => sum + (!!x ? x.secDmgBonus : 0), 0);
            }

            const secExceeded = resolvedDamage > targetCard.sec;
            GameEngineUtils.changeSec(targetCard, -resolvedDamage, broadcast);
            return secExceeded;
        };

    export const MemDmg = (memDmg: number): IScriptComp =>
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

    export const RaiseMem = (memBonus: number): IScriptComp =>
        (_gameData, _sourceCard, targetCard, broadcast) => {
            targetCard.mem += memBonus;
            broadcast.push({
                type: 'cardMemChange',
                cardId: targetCard.id,
                delta: memBonus,
                newMem: targetCard.mem,
            });
        };

    export const RaiseSec = (secBonus: number): IScriptComp =>
        (_gameData, _sourceCard, targetCard, broadcast) => {
            GameEngineUtils.changeSec(targetCard, secBonus, broadcast);
        };

    export const RedirectIntentRandom: IScriptComp =
        (gameData, _sourceCard, targetCard, broadcast) => {
            if (!GameEngineUtils.isEnemyCard(targetCard) || !targetCard.intent) return;

            const script = CardScript.deserialize(targetCard, targetCard.intent.scriptData);
            if (script.targetFinder === CardScript.TargetFinders.Self) return;

            targetCard.intent.targetCardId = [...GameEngineUtils.getEnemyIds(gameData), ...GameEngineUtils.getPlayerCardIds(gameData)].random();

            broadcast.push({
                type: 'cardIntent',
                cardId: targetCard.id,
                intent: targetCard.intent,
            });
        };

    export const RemoveMod = <T extends CardMod.ModLibrary, K extends (keyof T & string)>(modName: K, mustRemove = false): IScriptComp =>
        (gameData, sourceCard, targetCard, broadcast) => {
            if (mustRemove) {
                if (!targetCard.mods.find(x => x[0] === modName)) {
                    throw new Error(`Could not find [${modName}] to remove`);
                }
            }
            CardMod.removeModByName(gameData, targetCard, modName, broadcast, sourceCard);
        };
}