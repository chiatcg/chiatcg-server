import { IPlayerPushProvider } from '../dependencies';
import { clamp } from '../utils';
import { CardMod } from './card-mods';
import { CardScript } from './card-scripts';
import { GameEngine } from './game-engine';

export namespace GameEngineUtils {
    export function addEnemy(gameData: GameEngine.IGameData, enemy: GameEngine.IEnemyCardState, spawnIndex: number, generateIntent: boolean, broadcast: IPlayerPushProvider.IPushMessage[]) {
        spawnIndex = clamp(spawnIndex, 0, gameData.enemies.length);
        gameData.enemies.splice(spawnIndex, 0, enemy);
        broadcast.push({
            type: 'cardAdded',
            enemy,
            position: spawnIndex,
        });

        GameEngineUtils.triggerMods('onInit', { broadcast, gameData, sourceCard: enemy });

        if (generateIntent) {
            GameEngineUtils.generateIntent(gameData, enemy, broadcast);
        }
    }

    export function addScript(_gameData: GameEngine.IGameData, card: GameEngine.ICardState, scriptData: CardScript.ScriptData, broadcast: IPlayerPushProvider.IPushMessage[]) {
        card.scripts.push(scriptData);
        broadcast.push({
            type: 'scriptAdded',
            cardId: card.id,
            scriptData,
        });
    }

    export function changeCardIsUsed(card: GameEngine.IPlayerCardState, isUsed: boolean, broadcast: IPlayerPushProvider.IPushMessage[]) {
        card.isUsed = isUsed;
        broadcast.push({
            type: 'cardIsUsedChanged',
            cardId: card.id,
            isUsed,
        });
    }

    export function clearIntent(_gameData: GameEngine.IGameData, enemy: GameEngine.IEnemyCardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        const intent = enemy.intent;
        if (!intent) {
            return false;
        }

        enemy.intent = undefined;
        broadcast.push({
            type: 'cardIntent',
            cardId: enemy.id,
        });
        return true;
    }

    export function changeSec(card: GameEngine.ICardState, secDelta: number, broadcast: IPlayerPushProvider.IPushMessage[]) {
        card.sec = (card.sec < -secDelta) ? 0 : (card.sec + secDelta);
        broadcast.push({
            type: 'cardSecChange',
            cardId: card.id,
            newSec: card.sec,
        });
    }

    export function executeIntent(gameData: GameEngine.IGameData, enemy: GameEngine.IEnemyCardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        const intent = enemy.intent;
        if (!intent) {
            return false;
        }

        enemy.intent = undefined;

        let targetCard: GameEngine.ICardState | undefined;
        if (intent.targetCardId) {
            targetCard = findCardByIdMaybe(gameData, intent.targetCardId);
            if (!targetCard) {
                // Intent target could've been removed between intent generation and execution
                return false;
            }
        } else {
            targetCard = enemy;
        }

        CardScript.execute(gameData, enemy, intent.scriptData, targetCard, broadcast);
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

    export function findPlayerCardById(gameData: GameEngine.IGameData, cardId: string) {
        const player = findPlayerByCardIdMaybe(gameData, cardId);
        if (!player) throw new Error('player not found');

        return player.cards.find(x => x.id === cardId)!;
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

        const scriptData = enemy.scripts.filter(x => !CardScript.isOnCooldown(x)).randomOrUndefined();
        if (!scriptData) {
            return;
        }

        const script = CardScript.deserialize(enemy, scriptData);
        if (script.targetFinder === CardScript.TargetFinders.Self) {
            enemy.intent = {
                scriptData,
                targetCardId: '',
            };
        } else {
            const target = script.targetFinder(gameData, enemy).randomOrUndefined();
            if (!target) {
                return;
            }

            enemy.intent = {
                scriptData,
                targetCardId: target.id,
            };
        }

        broadcast.push({
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

    export function isEnemyCard(card: GameEngine.ICardState): card is GameEngine.IEnemyCardState {
        return card.id.length < 10;
    }

    export function isPlayerCard(card: GameEngine.ICardState): card is GameEngine.IPlayerCardState {
        return !isEnemyCard(card);
    }

    export function nextId(gameData: GameEngine.IGameData) {
        return `${gameData.nextId++}`;
    }

    export function recalculateScripts(card: GameEngine.ICardState, broadcast: IPlayerPushProvider.IPushMessage[]) {
        if (card.isRemoved) return;

        card.scripts = card.scripts.map(x => CardScript.deserialize(card, x).serialize());
        broadcast.push(...card.scripts.map(x => ({
            type: 'scriptChanged',
            cardId: card.id,
            scriptData: x,
        })));
    }

    export function revalidateIntents(gameData: GameEngine.IGameData, regenerateIfInvalid: boolean, broadcast: IPlayerPushProvider.IPushMessage[]) {
        for (const enemy of gameData.enemies) {
            if (!enemy.intent) {
                continue;
            }
            const script = CardScript.deserialize(enemy, enemy.intent.scriptData);
            const validTargets = script.targetFinder(gameData, enemy);
            if (validTargets.find(x => x.id === enemy.intent?.targetCardId)) {
                continue;
            }

            enemy.intent = undefined;
            if (regenerateIfInvalid) {
                generateIntent(gameData, enemy, broadcast);
            }
        }
    }

    export function removeCard(gameData: GameEngine.IGameData, card: GameEngine.ICardState, broadcast: IPlayerPushProvider.IPushMessage[], contextCard?: GameEngine.ICardState) {
        if (card.isRemoved) {
            return;
        }

        let isEnemyCard = false;
        if (gameData.enemies.removeFirst(card as GameEngine.IEnemyCardState)) {
            isEnemyCard = true;
            GameEngineUtils.triggerMods('onDestroy', { broadcast, contextCard, gameData, sourceCard: card });
            card.isRemoved = true;
            broadcast.push({
                type: 'cardRemoved',
                cardId: card.id,
            });
        }

        if (!card.isRemoved) {
            const player = GameEngineUtils.findPlayerByCardId(gameData, card.id);
            if (player.cards.removeFirst(card as GameEngine.IPlayerCardState)) {
                GameEngineUtils.triggerMods('onDestroy', { broadcast, contextCard, gameData, sourceCard: card });
                card.isRemoved = true;
                broadcast.push({
                    type: 'cardRemoved',
                    cardId: card.id,
                });
            }
        }

        if (!card.isRemoved) {
            throw new Error('card not found');
        }

        GameEngineUtils.revalidateIntents(gameData, isEnemyCard, broadcast);
    }

    export function triggerMods<T extends CardMod.ModEvent>(ev: T, ...args: Parameters<NonNullable<CardMod[typeof ev]>>): ReturnType<NonNullable<CardMod[typeof ev]>>[] {
        const deps = args[0];
        const card = deps.sourceCard;
        return [...card.mods]
            .map(modData => (!card.isRemoved && card.mods.find(x => CardMod.areEqual(x, modData))) ? CardMod.trigger(ev, modData, ...args) : undefined)
            .filter(Boolean);
    }
}