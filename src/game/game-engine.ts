import { IAppraisedCard, appraiseCard } from '../appraise';
import { IDataSource, IPlayerPushProvider } from '../dependencies';
import { ExtDeps } from '../external-dependencies';
import { CardMod } from './card-mods';
import { CardScript } from './card-scripts';
import { GameEngineUtils } from './game-engine-utils';

export namespace GameEngine {
    interface _ICommonCardState {
        id: string;
        cpu: number;
        mem: number;
        sec: number;
        mods: CardMod.ModData[];
        scripts: CardScript.ScriptData[];

        isRemoved?: boolean;
    }

    export interface IGameData {
        id: string;
        difficulty: number;
        state: 'created' | 'started' | 'players_won' | 'players_lost' | 'ended';
        ruleSetId: string;

        enemies: IEnemyCardState[];
        players: Map<string, IPlayerState>;
        playerMovesPerTurn: number;
        turn: number;
        nextId: number;
    }

    export interface IPlayerState {
        id: string;
        cards: IPlayerCardState[];
        endedTurn: boolean;
        movesLeft: number;
    }

    export interface IPlayerCardState extends _ICommonCardState {
        card: IAppraisedCard;
        isUsed: boolean;
    }

    export interface IEnemyCardState extends _ICommonCardState {
        enemyClass: string;
        intent?: { scriptData: CardScript.ScriptData, targetCardId: string };
        maxMem: number;
    }
    export type ICardState = IPlayerCardState | IEnemyCardState;
    export abstract class GameEngineError extends Error {
        constructor(
            public gameId: string,
        ) {
            super();
            this.message = `${this.constructor.name} processing game ${gameId}`;
        }
    }

    export class GameNotFoundError extends GameEngineError { }

    export interface IGameContentPlugin {
        cardMods: CardMod.ModConstructor[];
        cardScripts: CardScript.ScriptConstructor[];

        createFirstEnemy(id: string): IEnemyCardState;
        createEnemy(enemyClass: string, id: string): IEnemyCardState;
        addAdditionalScriptsFor(card: IPlayerCardState): void;
    }
}

export const createGameEngine = (contentPlugin: GameEngine.IGameContentPlugin, ds: IDataSource, playerPushProvider: IPlayerPushProvider) => {
    contentPlugin.cardMods.forEach(mod => (CardMod.Content as CardMod.ModLibrary)[mod.name] = mod);
    contentPlugin.cardScripts.forEach(script => (CardScript.Content as CardScript.ScriptLibrary)[script.name] = script);

    return {
        async beginGameDataTransaction<T>(gameId: string, stateAssertion: GameEngine.IGameData['state'][], func: (gameData: GameEngine.IGameData, broadcast: IPlayerPushProvider.IPushMessage[]) => Promise<T>): Promise<T | null> {
            const gameData = await ds.GameData.get(gameId);
            if (!gameData) throw new GameEngine.GameNotFoundError(gameId);

            let broadcast: IPlayerPushProvider.IPushMessage[] = [];
            let result: Awaited<T> | null = null;
            try {
                if (stateAssertion.length && !stateAssertion.includes(gameData.state)) throw new Error('wrong game state');

                result = await func(gameData, broadcast);
                await ds.GameData.update.exec(gameData);
            } catch (e: any) {
                broadcast = [{
                    type: 'server_error',
                    broadcast,
                    message: e.message,
                    stack: e.stack,
                }];
                throw e;
            } finally {
                if (broadcast.length) {
                    await Promise.all(
                        [...gameData.players.keys()].map(playerId => playerPushProvider.push(playerId, broadcast)),
                    );
                }
            }

            return result;
        },

        async createGame(gameId: string, firstPlayerId: string, cardIds: string[]) {
            const gameData: GameEngine.IGameData = {
                id: gameId,
                difficulty: 1,
                state: 'created',
                turn: 0,
                ruleSetId: 'coop',
                players: new Map(),
                playerMovesPerTurn: 4,
                enemies: [],
                nextId: 1,
            };
            gameData.players.set(firstPlayerId, await this._createPlayerState(gameData, firstPlayerId, cardIds));
            await ds.GameData.update.exec(gameData);
        },

        async startGame(gameId: string) {
            await this.beginGameDataTransaction(gameId, ['created'], async (gameData, broadcast) => {
                gameData.state = 'started';
                broadcast.push({ type: 'gameStart' });

                const firstEnemy = contentPlugin.createFirstEnemy(GameEngineUtils.nextId(gameData));
                GameEngineUtils.addEnemy(gameData, firstEnemy, 0, true, broadcast);
                GameEngineUtils.triggerMods('onGameStart', { broadcast, gameData, sourceCard: firstEnemy });
            });
        },

        async endGame(gameId: string) {
            return this.beginGameDataTransaction(gameId, ['created', 'started'], async (gameData, broadcast) => {
                gameData.state = 'ended';
                broadcast.push({ type: 'gameEnd' });
                return true;
            });
        },

        async addPlayer(gameId: string, playerId: string, cardIds: string[]) {
            return this.beginGameDataTransaction(gameId, [], async (gameData, broadcast) => {
                const playerState = await this._createPlayerState(gameData, playerId, cardIds);

                if (gameData.players.has(playerId)) throw new Error('player already in game');

                gameData.players.set(playerId, playerState);
                broadcast.push({ type: 'playerJoin', playerState });
                return true;
            });
        },

        async removePlayer(gameId: string, playerId: string, reason: 'idle' | 'leave') {
            return this.beginGameDataTransaction(gameId, [], async (gameData, broadcast) => {
                if (!gameData.players.delete(playerId)) throw new Error('player not found');

                broadcast.push({ type: 'playerLeave', playerId, reason });
                return true;
            });
        },

        async requestCardTargets(gameId: string, playerId: string, cardId: string, scriptName: string) {
            const gameData = await this.getGameData(gameId);
            const card = GameEngineUtils.findPlayerCardById(gameData, cardId);
            if (card.isUsed) {
                throw new Error(`[${cardId}] is used`);
            }

            const scriptData = card.scripts.find(x => x[0] === scriptName);
            if (!scriptData) {
                throw new Error(`Script [${scriptName}] not found in card [${cardId}]`);
            }

            const script = CardScript.deserialize(card, scriptData);
            await playerPushProvider.push(playerId, [{
                type: 'cardTargets',
                cardId,
                scriptName,
                targetCardIds: script.targetFinder(gameData, card).map(x => x.id),
            }]);
        },

        async intent(gameId: string, playerId: string, sourceCardId?: string, sourceCardScript?: string, targetCardId?: string) {
            const gameData = await this.getGameData(gameId);
            const pushMessage: IPlayerPushProvider.IPushMessage[] = [{
                type: 'cardIntent',
                cardId: sourceCardId,
                intent: {
                    scriptData: sourceCardScript,
                    targetCardId,
                },
                playerId,
            }];
            await Promise.all(
                [...gameData.players.keys()].filter(x => x !== playerId).map(x => playerPushProvider?.push(x, pushMessage)),
            );
        },

        async makeMove(gameId: string, playerId: string, sourceCardId: string, sourceCardScript: CardScript.ScriptData, targetCardId: string) {
            return this.beginGameDataTransaction(gameId, ['started'], async (gameData, broadcast) => {
                const playerState = GameEngineUtils.findPlayerByCardId(gameData, sourceCardId);
                if (playerState.id !== playerId) {
                    throw new Error(`Player ${playerId} cannot make move on card ${sourceCardId} from owner ${playerState.id}`);
                }
                if (!playerState.movesLeft) {
                    throw new Error(`No moves left`);
                }
                const sourceCard = playerState.cards.find(x => x.id === sourceCardId)!;
                if (sourceCard.isUsed) {
                    throw new Error(`Card is used`);
                }

                const targetCard = GameEngineUtils.findCardById(gameData, targetCardId);
                CardScript.execute(gameData, sourceCard, sourceCardScript, targetCard, broadcast);
                GameEngineUtils.changeCardIsUsed(sourceCard, true, broadcast);
                playerState.movesLeft--;
            });
        },

        async toggleEndTurn(gameId: string, playerId: string) {
            return this.beginGameDataTransaction(gameId, ['started'], async (gameData, broadcast) => {
                const playerState = gameData.players.get(playerId);
                if (!playerState) throw new Error('player not found');

                if (playerState.endedTurn) {
                    playerState.endedTurn = false;
                    broadcast.push({
                        type: 'playerToggleEndTurn',
                        playerId,
                        state: false,
                    });
                    return;
                }

                playerState.endedTurn = true;
                broadcast.push({
                    type: 'playerToggleEndTurn',
                    playerId,
                    state: true,
                });

                if (![...gameData.players.values()].reduce((numNotReady, playerState) => playerState.endedTurn ? numNotReady : (numNotReady + 1), 0)) {
                    this._onEndTurn(gameData, broadcast);
                    if (gameData.state !== 'started') {
                        return;
                    }
                    this._onTurnStart(gameData, broadcast);
                }
            });
        },

        async getGameData(gameId: string) {
            const gameData = await ds.GameData.get(gameId);
            if (!gameData) throw new GameEngine.GameNotFoundError(gameId);
            return gameData;
        },

        async _createPlayerState(gameData: GameEngine.IGameData, playerId: string, cardIds: string[]): Promise<GameEngine.IPlayerState> {
            const cards = (await Promise.all(cardIds.map(ExtDeps.getNft)))
                .filter((resp): resp is NonNullable<typeof resp> => !!resp?.nft)
                .map(resp => appraiseCard({ nftId: resp.nft.nftId, url: resp.nft.urls[0] || '' }));

            if (cards.length !== cardIds.length) {
                throw `could not resolve all cards for player ${playerId}`;
            }

            const player: GameEngine.IPlayerState = {
                id: playerId,
                cards: cards.map(card => ({
                    id: card.nftId,
                    card,
                    isUsed: false,
                    cpu: card.cpu,
                    mem: card.mem,
                    sec: card.tier * 5,
                    mods: [],
                    scripts: [],
                })),
                endedTurn: false,
                movesLeft: gameData.playerMovesPerTurn,
            };
            for (const card of player.cards) {
                card.scripts = [
                    CardScript.fromScriptName(card, card.card.coreScript),
                ];
                contentPlugin.addAdditionalScriptsFor(card);
            }
            return player;
        },

        _onTurnStart(gameData: GameEngine.IGameData, broadcast: IPlayerPushProvider.IPushMessage[]) {
            gameData.turn++;
            broadcast.push({
                type: 'newTurn',
                turn: gameData.turn,
            });

            for (const player of gameData.players.values()) {
                player.endedTurn = false;
                player.movesLeft = gameData.playerMovesPerTurn;
            }

            const playerCards = GameEngineUtils.getPlayerCards(gameData);
            for (const playerCard of playerCards) {
                GameEngineUtils.changeCardIsUsed(playerCard, false, broadcast);
            }

            for (const enemy of gameData.enemies) {
                if (!gameData.enemies.includes(enemy)) continue;
                GameEngineUtils.triggerMods('onTurnStart', { broadcast, gameData, sourceCard: enemy });
            }

            for (const playerCard of [...playerCards]) {
                if (!playerCards.includes(playerCard)) continue;
                GameEngineUtils.triggerMods('onTurnStart', { broadcast, gameData, sourceCard: playerCard });
            }

            this._checkGameOver(gameData, broadcast);
        },

        _onEndTurn(gameData: GameEngine.IGameData, broadcast: IPlayerPushProvider.IPushMessage[]) {
            const playerCards = GameEngineUtils.getPlayerCards(gameData);
            for (const playerCard of playerCards) {
                if (!playerCards.includes(playerCard)) continue;
                GameEngineUtils.triggerMods('onTurnEnd', { broadcast, gameData, sourceCard: playerCard });
                CardScript.tickCooldowns(playerCard, broadcast);
            }

            broadcast.push({
                type: 'playerTurnEnded',
            });

            for (const enemy of gameData.enemies) {
                if (!gameData.enemies.includes(enemy)) continue;
                GameEngineUtils.triggerMods('onTurnEnd', { broadcast, gameData, sourceCard: enemy });
                CardScript.tickCooldowns(enemy, broadcast);
            }

            broadcast.push({
                type: 'enemyTurnEnded',
            });

            this._checkGameOver(gameData, broadcast);
        },

        _checkGameOver(gameData: GameEngine.IGameData, broadcast: IPlayerPushProvider.IPushMessage[]) {
            if (gameData.state === 'players_lost' || !GameEngineUtils.getPlayerCards(gameData).length) {
                gameData.state = 'players_lost';
                broadcast.push({
                    type: 'players_lost',
                });
                return;
            }

            if (gameData.state === 'players_won' || !gameData.enemies.length) {
                gameData.state = 'players_won';
                broadcast.push({
                    type: 'players_won',
                });
                return;
            }
        },
    }
}
export type GameEngine = ReturnType<typeof createGameEngine>;