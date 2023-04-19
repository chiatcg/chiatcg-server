import { IPlayerPushProvider } from '../dependencies';
import { clamp } from '../utils';
import { CardMod } from './card-mods';
import { CardScript } from './card-scripts';
import { GameEngine } from './game-engine';

export namespace GameEngineUtils {
    export function addEnemy(gameData: GameEngine.IGameData, enemy: GameEngine.IEnemyCardState, spawnIndex: number, broadcast: IPlayerPushProvider.IPushMessage[]) {
        spawnIndex = clamp(spawnIndex, 0, gameData.enemies.length);
        gameData.enemies.splice(spawnIndex, 0, enemy);
        broadcast.push({
            type: 'enemyAdded',
            enemy,
            spawnIndex,
        });
    }

    export function executeIntent(gameData: GameEngine.IGameData, enemy: GameEngine.IEnemyCardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        if (!enemy.intent) {
            return false;
        }

        const targetCard = findCardByIdMaybe(gameData, enemy.intent.targetCardId);
        if (!targetCard) {
            // Intent target could've been removed between intent generation and execution
            enemy.intent = undefined;
            return false;
        }

        const script = CardScript.deserialize(enemy.intent.scriptData, enemy);
        script.execute(gameData, enemy, targetCard, broadcast);
        enemy.intent = undefined;
        return true;
    }

    export function findCardById(gameData: GameEngine.IGameData, cardId: string) {
        const card = findCardByIdMaybe(gameData, cardId);
        if (card) return card;

        throw new Error('card not found');
    }

    export function findCardByIdMaybe(gameData: GameEngine.IGameData, cardId: string) {
        if (cardId.length < 10) {
            return gameData.enemies.find(x => x.id === cardId);
        }

        const player = findPlayerByCardIdMaybe(gameData, cardId);
        if (player) {
            return player.cards.find(x => x.id === cardId);
        }
        return;
    }

    export function findPlayerByCardId(gameData: GameEngine.IGameData, cardId: string) {
        const player = findPlayerByCardIdMaybe(gameData, cardId);
        if (player) return player;

        throw new Error('player not found');
    }

    export function findPlayerByCardIdMaybe(gameData: GameEngine.IGameData, cardId: string) {
        return [...gameData.players.values()].find(x => x.cards.find(x => x.id === cardId));
    }

    export function generateIntent(gameData: GameEngine.IGameData, enemy: GameEngine.IEnemyCardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        enemy.intent = undefined;

        const scriptData = enemy.scripts.randomOrUndefined();
        if (!scriptData) {
            return;
        }

        const script = CardScript.deserialize(scriptData, enemy);
        const target = script.findTargets(gameData, enemy).randomOrUndefined();
        if (!target) {
            return;
        }

        enemy.intent = {
            scriptData,
            targetCardId: target.id,
        };

        broadcast.push({
            type: 'enemyIntent',
            enemyId: enemy.id,
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

    export function isEnemyCard(card: GameEngine.ICardState): card is GameEngine.IEnemyCardState {
        return card.id.length < 10;
    }

    export function isPlayerCard(card: GameEngine.ICardState): card is GameEngine.IPlayerCardState {
        return !isEnemyCard(card);
    }

    export function nextId(gameData: GameEngine.IGameData) {
        return `${gameData.nextId++}`;
    }

    export function removeCard(gameData: GameEngine.IGameData, card: GameEngine.ICardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        if (card.isRemoved) {
            return;
        }

        if (gameData.enemies.removeFirst(card as GameEngine.IEnemyCardState)) {
            card.isRemoved = true;
            broadcast.push({
                type: 'enemyDestroyed',
                id: card.id,
            });
        }

        if (!card.isRemoved) {
            const player = GameEngineUtils.findPlayerByCardId(gameData, card.id);
            if (player.cards.removeFirst(card as GameEngine.IPlayerCardState)) {
                card.isRemoved = true;
                broadcast.push({
                    type: 'playerCardDestroyed',
                    cardId: card.id,
                    playerId: player.id,
                });
            }
        }

        if (!card.isRemoved) {
            throw new Error('card not found');
        }

        for (const enemy of gameData.enemies) {
            if (enemy.intent?.targetCardId === card.id) {
                GameEngineUtils.generateIntent(gameData, enemy, broadcast);
            }
        }
    }

    export function triggerMods(gameData: GameEngine.IGameData, card: GameEngine.ICardState, ev: CardMod.ModEvent, broadcast: IPlayerPushProvider.IPushMessage[], contextCard?: GameEngine.ICardState) {
        const modDeps: CardMod.ICardModDeps = {
            broadcast,
            gameData,
            sourceCard: card,
            contextCard,
        };

        for (const modData of [...card.mods]) {
            if (!card.mods.includes(modData)) {
                continue;
            }
            const mod = CardMod.deserialize(modData);
            mod.trigger(ev, modDeps);
        }
    }
}