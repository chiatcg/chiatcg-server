import { clamp, round } from '../utils';
import { CardMod } from './card-mods';
import { CardScript } from './card-scripts';
import { GameEngine } from './game-engine';

export namespace GameEngineUtils {
    export function addEnemy(engine: GameEngine.IGameEngine, enemy: GameEngine.IEnemyCardState, spawnIndex: number, generateIntent: boolean) {
        if (engine.gameData.enemies.length >= engine.gameData.maxEnemies) return;

        spawnIndex = clamp(spawnIndex, 0, engine.gameData.enemies.length);
        engine.gameData.enemies.splice(spawnIndex, 0, enemy);
        engine.broadcast.push({
            type: 'cardAdded',
            enemy,
            position: spawnIndex,
        });

        GameEngineUtils.triggerMods('onInitMod', { engine, sourceCard: enemy });

        if (generateIntent) {
            GameEngineUtils.generateIntent(engine, enemy);
        }
        return enemy;
    }

    export function changeCardIsUsed(engine: GameEngine.IGameEngine, card: GameEngine.IPlayerCardState, isUsed: boolean) {
        card.isUsed = isUsed;
        engine.broadcast.push({
            type: 'cardIsUsedChanged',
            cardId: card.id,
            isUsed,
        });
    }

    export function clearIntent(engine: GameEngine.IGameEngine, enemy: GameEngine.IEnemyCardState) {
        const intent = enemy.intent;
        if (!intent) {
            return false;
        }

        enemy.intent = undefined;
        engine.broadcast.push({
            type: 'cardIntent',
            cardId: enemy.id,
        });
        return true;
    }

    export function changeCpu(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, cpuDelta: number) {
        card.cpu += cpuDelta;
        engine.broadcast.push({
            type: 'cpuChanged',
            cardId: card.id,
            newCpu: card.cpu,
            cpuDelta,
        });

        GameEngineUtils.recalculateScripts(engine, card);
    }

    export function changeMem(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, memDelta: number) {
        card.mem += memDelta;
        engine.broadcast.push({
            type: 'memChanged',
            cardId: card.id,
            newMem: card.mem,
            memDelta,
        });

        GameEngineUtils.recalculateScripts(engine, card);
    }

    export function changeSec(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, secDelta: number, isPassive: boolean, contextCard?: GameEngine.ICardState) {
        const clampedSecDelta = (card.sec < -secDelta) ? -card.sec : secDelta;
        card.sec += clampedSecDelta;
        engine.broadcast.push({
            type: isPassive ? 'secChange' : (secDelta < 0 ? 'secDamage' : 'secBonus'),
            cardId: card.id,
            newSec: card.sec,
            value: secDelta,
        });

        if (!isPassive && contextCard) {
            const player = GameEngineUtils.findPlayerByCardIdMaybe(engine.gameData, contextCard.id);
            if (player) {
                (clampedSecDelta >= 0) ? (player.stats.secBonus += clampedSecDelta) : (player.stats.secDmg += -clampedSecDelta);
            }
        }
    }

    export function executeIntent(engine: GameEngine.IGameEngine, enemy: GameEngine.IEnemyCardState, dontClearIntent = false) {
        const intent = enemy.intent;
        if (!intent) {
            return false;
        }

        enemy.intent = dontClearIntent ? enemy.intent : undefined;

        let targetCard: GameEngine.ICardState | undefined;
        if (intent.targetCardId >= 0) {
            targetCard = findCardByIdMaybe(engine.gameData, intent.targetCardId);
            if (!targetCard) {
                // Intent target could've been removed between intent generation and execution
                return false;
            }
        } else {
            targetCard = enemy;
        }

        CardScript.execute(engine, enemy, intent.scriptData, targetCard);
        return true;
    }

    export function findCardById(gameData: GameEngine.IGameData, cardId: number) {
        const card = findCardByIdMaybe(gameData, cardId);
        if (card) return card;

        throw new Error('card not found');
    }

    export function findCardByIdMaybe(gameData: GameEngine.IGameData, cardId: number) {
        const enemy = gameData.enemies.find(x => x.id === cardId);
        if (enemy) return enemy;

        const player = findPlayerByCardIdMaybe(gameData, cardId);
        if (player) {
            return player.cards.find(x => x.id === cardId);
        }
        return;
    }

    export function findPlayerCardById(gameData: GameEngine.IGameData, cardId: number) {
        const player = findPlayerByCardIdMaybe(gameData, cardId);
        if (!player) throw new Error('player not found');

        return player.cards.find(x => x.id === cardId)!;
    }

    export function findPlayerByCardId(gameData: GameEngine.IGameData, cardId: number) {
        const player = findPlayerByCardIdMaybe(gameData, cardId);
        if (player) return player;

        throw new Error('player not found');
    }

    export function findPlayerByCardIdMaybe(gameData: GameEngine.IGameData, cardId: number) {
        return [...gameData.players.values()].find(x => x.cards.find(x => x.id === cardId));
    }

    export function generateIntent(engine: GameEngine.IGameEngine, enemy: GameEngine.IEnemyCardState) {
        enemy.intent = undefined;

        const isOffline = !!enemy.mods.find(x => x[0] === 'offline');
        if (isOffline) return;

        const scriptData = enemy.scripts.filter(x => !CardScript.isOnCooldown(x)).randomOrUndefined();
        if (!scriptData) {
            return;
        }

        const script = CardScript.deserialize(engine, enemy, scriptData);
        const target = script.targetFinder(engine.gameData, enemy).randomOrUndefined();
        if (!target) {
            return;
        }

        enemy.intent = {
            scriptData,
            targetCardId: target.id,
        };

        engine.broadcast.push({
            type: 'cardIntent',
            cardId: enemy.id,
            intent: enemy.intent,
        });
    }

    export function getEnemyIds(gameData: GameEngine.IGameData) {
        return gameData.enemies.map(x => x.id);
    }

    export function getPlayerIds(gameData: GameEngine.IGameData, ...excludePlayer: string[]) {
        return [...gameData.players.keys()].filter(x => !excludePlayer.includes(x));
    }

    export function getPlayerCards(gameData: GameEngine.IGameData) {
        return [...gameData.players.values()].map(x => x.cards).flat();
    }

    export function getPlayerCardIds(gameData: GameEngine.IGameData) {
        return getPlayerCards(gameData).map(x => x.id);
    }

    export function isEnemyCard(gameData: GameEngine.IGameData, card: GameEngine.ICardState): card is GameEngine.IEnemyCardState {
        return !!gameData.enemies.find(x => x.id === card.id);
    }

    export function isPlayerCard(gameData: GameEngine.IGameData, card: GameEngine.ICardState): card is GameEngine.IPlayerCardState {
        return !isEnemyCard(gameData, card);
    }

    export function recalculateScripts(engine: GameEngine.IGameEngine, card: GameEngine.ICardState) {
        if (card.isRemoved) return;

        card.scripts = card.scripts.map(x => CardScript.deserialize(engine, card, x).serialize());
        engine.broadcast.push(...card.scripts.map(x => ({
            type: 'scriptChanged',
            cardId: card.id,
            scriptData: x,
        })));

        if (isEnemyCard(engine.gameData, card) && card.intent?.scriptData) {
            card.intent.scriptData = CardScript.deserialize(engine, card, card.intent.scriptData).serialize();
            engine.broadcast.push({
                type: 'cardIntent',
                cardId: card.id,
                intent: card.intent,
            });
        }
    }

    export function revalidateIntents(engine: GameEngine.IGameEngine, regenerateIfInvalid: boolean) {
        for (const enemy of engine.gameData.enemies) {
            if (!enemy.intent || enemy.intent.targetCardId === -1) {
                continue;
            }

            const script = CardScript.deserialize(engine, enemy, enemy.intent.scriptData);
            const validTargets = script.targetFinder(engine.gameData, enemy);
            if (validTargets.find(x => x.id === enemy.intent?.targetCardId)) {
                continue;
            }

            enemy.intent = undefined;
            if (regenerateIfInvalid) {
                generateIntent(engine, enemy);
            }
        }
    }

    export function removeCard(engine: GameEngine.IGameEngine, card: GameEngine.ICardState, contextCard?: GameEngine.ICardState) {
        if (card.isRemoved) {
            return;
        }

        if (isEnemyCard(engine.gameData, card)) {
            engine.gameData.enemies.removeFirst(card)

            engine.broadcast.push({
                type: 'cardRemoved',
                cardId: card.id,
            });

            GameEngineUtils.triggerMods('onCardDestroyed', { engine, contextCard, sourceCard: card });
            card.isRemoved = true;

            for (const enemy of [...engine.gameData.enemies]) {
                if (enemy.isRemoved) continue;
                triggerMods('onEnemyDestroyed', { engine, sourceCard: card, contextCard });
            }

            if (contextCard) {
                const player = findPlayerByCardIdMaybe(engine.gameData, contextCard.id);
                player && player.stats.kills++;
            }

            GameEngineUtils.revalidateIntents(engine, true);
        } else {
            const player = GameEngineUtils.findPlayerByCardId(engine.gameData, card.id);
            player.cards.removeFirst(card);

            engine.broadcast.push({
                type: 'cardRemoved',
                cardId: card.id,
            });

            GameEngineUtils.triggerMods('onCardDestroyed', { engine, contextCard, sourceCard: card });
            card.isRemoved = true;

            GameEngineUtils.revalidateIntents(engine, false);
        }
    }

    export function scaleByCpuMem(baseValue: number, cpuMem: number, cpuMemScaling: 'normal' | 'less' | 'more' | 'minimal' | 'high' = 'normal') {
        let valuePerCpu = baseValue / 2;
        switch (cpuMemScaling) {
            case 'high': valuePerCpu * 1.5; break;
            case 'more': valuePerCpu * 1.25; break;
            case 'less': valuePerCpu * .75; break;
            case 'minimal': valuePerCpu * .5; break;
        }

        return Math.round(baseValue + ((cpuMem - 1) * valuePerCpu));
    }

    export function scaleByDifficulty(value: number, difficulty: number, decimals = 0) {
        return round(value * Math.pow(1.1, difficulty - 1), decimals);
    }

    export function spawnEnemy(engine: GameEngine.IGameEngine, enemyClass: string, spawnIndex: number, generateIntent: boolean) {
        const enemyFactory = engine.ruleset.enemyCards?.[enemyClass];
        if (!enemyFactory) throw new Error('EnemyClass not found for spawning: ' + enemyClass);
        const enemy = enemyFactory(engine);
        enemy.enemyClass = enemyClass;
        return addEnemy(engine, enemy, spawnIndex, generateIntent);
    }

    export function triggerMods<T extends CardMod.ModEvent>(ev: T, ...args: Parameters<NonNullable<CardMod[typeof ev]>>): ReturnType<NonNullable<CardMod[typeof ev]>>[] {
        const deps = args[0];
        const card = deps.sourceCard;
        return [...card.mods]
            .map(modData => (!card.isRemoved && card.mods.find(x => CardMod.areEqual(x, modData))) ? CardMod.trigger(ev, modData, ...args) : undefined)
            .filter(Boolean);
    }
}