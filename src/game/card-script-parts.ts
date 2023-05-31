import { CardMod } from './card-mods';
import { CardScript } from './card-scripts';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

export namespace CardScriptParts {
    export interface IScriptPart {
        (engine: GameEngine.IGameEngine, sourceCard: GameEngine.ICardState, targetCard: GameEngine.ICardState): void;
    }

    export const _Chance = (chance: number, curriedPart: IScriptPart): IScriptPart =>
        (engine, sourceCard, targetCard) => {
            if (Math.random() < chance) {
                curriedPart(engine, sourceCard, targetCard);
            }
        };

    export const _TargetHasMod = <T extends CardMod.ModLibrary, K extends keyof T>(modName: K, curry: (mod: InstanceType<T[K]>) => IScriptPart): IScriptPart =>
        (engine, sourceCard, targetCard) => {
            const mod = targetCard.mods.find(x => x[0] === modName);
            if (mod) {
                curry(CardMod.deserialize(engine, mod) as InstanceType<T[K]>)(engine, sourceCard, targetCard);
            }
        };

    export const AddMod = (mod: CardMod): IScriptPart =>
        (engine, sourceCard, targetCard) => {
            CardMod.addMod(engine, targetCard, mod, sourceCard);
        };

    export const Attack = (damage: number, dontTriggerOut = false, dontTriggerIn = false): IScriptPart =>
        (engine, sourceCard, targetCard) => {
            const secExceeded = SecDmg(damage, dontTriggerOut, dontTriggerIn)(engine, sourceCard, targetCard) as unknown;
            if (secExceeded) {
                MemDmg(1)(engine, sourceCard, targetCard);
            }
        };

    export const SecDmg = (secDmg: number, dontTriggerOut = false, dontTriggerIn = false): IScriptPart =>
        (engine, sourceCard, targetCard) => {
            let resolvedDamage = secDmg;
            if (!dontTriggerOut) {
                resolvedDamage += GameEngineUtils.triggerMods('onSecDamageOut', { engine, sourceCard, contextCard: targetCard }, resolvedDamage)
                    .reduce((sum, x) => sum + (!!x ? x.secDmgBonus : 0), 0);
            }

            if (!dontTriggerIn) {
                resolvedDamage += GameEngineUtils.triggerMods('onSecDamageIn', { engine, sourceCard: targetCard, contextCard: sourceCard }, resolvedDamage, sourceCard)
                    .reduce((sum, x) => sum + (!!x ? x.secDmgBonus : 0), 0);
            }

            if (CardMod.findModOfType(targetCard, CardMod.Content.impervious)) {
                return false;
            }

            resolvedDamage = Math.max(0, resolvedDamage);

            const secExceeded = resolvedDamage > targetCard.sec;
            GameEngineUtils.changeSec(engine, targetCard, -resolvedDamage, false, sourceCard);
            return secExceeded;
        };

    export const MemDmg = (memDmg: number): IScriptPart =>
        (engine, sourceCard, targetCard) => {
            GameEngineUtils.triggerMods('onMemDmgOut', { engine, sourceCard, contextCard: targetCard }, memDmg);
            GameEngineUtils.triggerMods('onMemDmgIn', { engine, sourceCard: targetCard, contextCard: sourceCard }, memDmg);

            if (CardMod.findModOfType(targetCard, CardMod.Content.impervious)) {
                return;
            }

            targetCard.mem -= memDmg;
            engine.broadcast.push({
                type: 'memDamage',
                cardId: targetCard.id,
                newMem: targetCard.mem,
                value: -memDmg,
            });

            const player = GameEngineUtils.findPlayerByCardIdMaybe(engine.gameData, sourceCard.id);
            player && (player.stats.memDmg += memDmg);

            if (targetCard.mem <= 0) {
                GameEngineUtils.removeCard(engine, targetCard, sourceCard);
            }
        };

    export const ChangeCpu = (cpuDelta: number): IScriptPart =>
        (engine, _sourceCard, targetCard) => {
            GameEngineUtils.changeCpu(engine, targetCard, cpuDelta);
        };

    export const RaiseMem = (memBonus: number): IScriptPart =>
        (engine, _sourceCard, targetCard) => {
            targetCard.mem += memBonus;
            engine.broadcast.push({
                type: 'memBonus',
                cardId: targetCard.id,
                newMem: targetCard.mem,
                value: memBonus,
            });
        };

    export const RaiseSec = (secBonus: number): IScriptPart =>
        (engine, sourceCard, targetCard) => {
            GameEngineUtils.changeSec(engine, targetCard, secBonus, false, sourceCard);
        };

    export const RedirectIntentRandom: IScriptPart =
        (engine, _sourceCard, targetCard) => {
            if (!GameEngineUtils.isEnemyCard(engine.gameData, targetCard) || !targetCard.intent) return;

            const script = CardScript.deserialize(engine, targetCard, targetCard.intent.scriptData);
            if (script.targetFinder === CardScript.TargetFinders.Self) return;

            const targets = script.targetFinder(engine.gameData, targetCard);
            if (!targets.length || (targets.length === 1 && targets[0]?.id === targetCard.intent.targetCardId)) return;

            const origTargetId = targetCard.intent.targetCardId;
            while (targetCard.intent.targetCardId === origTargetId) {
                targetCard.intent.targetCardId = targets.random().id;
            }

            engine.broadcast.push({
                type: 'cardIntent',
                cardId: targetCard.id,
                intent: targetCard.intent,
            });
        };

    export const RemoveMod = <T extends CardMod.ModLibrary, K extends (keyof T & string)>(modName: K, mustRemove = false): IScriptPart =>
        (engine, sourceCard, targetCard) => {
            if (mustRemove) {
                if (!targetCard.mods.find(x => x[0] === modName)) {
                    throw new Error(`Could not find [${modName}] to remove`);
                }
            }
            CardMod.removeModByName(engine, targetCard, modName, sourceCard);
        };

    export const SpawnEnemy = (enemyClass: string, spawnPosition?: 'relLeft' | 'relRight' | 'absLeft' | 'absRight', generateIntent = false): IScriptPart =>
        (engine, sourceCard, _targetCard) => {
            let spawnIndex = engine.gameData.enemies.findIndex(x => x.id === sourceCard.id);
            switch (spawnPosition) {
                case 'absLeft': spawnIndex = 0; break;
                case 'absRight': spawnIndex = engine.gameData.enemies.length; break;
                case 'relRight': spawnIndex++; break;
            }
            GameEngineUtils.spawnEnemy(engine, enemyClass, spawnIndex, generateIntent);
        };
}