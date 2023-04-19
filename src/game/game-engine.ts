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
        turn: number;
        nextId: number;
    }

    export interface IPlayerState {
        id: string;
        cards: IPlayerCardState[];
        endedTurn: boolean;
    }

    export interface IPlayerCardState extends _ICommonCardState {
        card: IAppraisedCard;
        isUsed: boolean;
    }

    export interface IEnemyCardState extends _ICommonCardState {
        enemyClass: string;
        intent?: { scriptData: CardScript.ScriptData, targetCardId: string };
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
        cardMods: (typeof CardMod)[]
        cardScripts: CardScript.CardScriptConstructor[];

        createFirstEnemy(id: string): IEnemyCardState;
        createEnemy(enemyClass: string, id: string): IEnemyCardState;
    }
}

export const createGameEngine = (contentPlugin: GameEngine.IGameContentPlugin, ds: IDataSource, playerPushProvider: IPlayerPushProvider) => {
    contentPlugin.cardMods.forEach(mod => (CardMod as any)[mod.name] = mod);
    contentPlugin.cardScripts.forEach(script => (CardScript as any)[script.name] = script);

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
            const playerState = await this._createPlayerState(firstPlayerId, cardIds);

            const gameData: GameEngine.IGameData = {
                id: gameId,
                difficulty: 1,
                state: 'created',
                turn: 0,
                ruleSetId: 'coop',
                players: new Map([[firstPlayerId, playerState]]),
                enemies: [],
                nextId: 1,
            };

            await ds.GameData.update.exec(gameData);
        },

        async startGame(gameId: string) {
            await this.beginGameDataTransaction(gameId, ['created'], async (gameData, broadcast) => {
                gameData.state = 'started';
                broadcast.push({ type: 'gameStart' });

                const firstEnemy = contentPlugin.createFirstEnemy(GameEngineUtils.nextId(gameData));
                GameEngineUtils.addEnemy(gameData, firstEnemy, 0, broadcast);
                GameEngineUtils.generateIntent(gameData, firstEnemy, broadcast);
                GameEngineUtils.triggerMods(gameData, firstEnemy, 'onGameStart', broadcast);
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
            const playerState = await this._createPlayerState(playerId, cardIds);

            return this.beginGameDataTransaction(gameId, [], async (gameData, broadcast) => {
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

        async intent(gameId: string, playerId: string, sourceCardId?: string, sourceCardScript?: string, targetCardId?: string) {
            const gameData = await this.getGameData(gameId);
            const pushMessage: IPlayerPushProvider.IPushMessage[] = [{
                type: 'playerIntent',
                playerId,
                sourceCardId,
                sourceCardScript,
                targetCardId,
            }];
            await Promise.all(
                [...gameData.players.keys()].filter(x => x !== playerId).map(x => playerPushProvider?.push(x, pushMessage)),
            );
        },

        async makeMove(gameId: string, playerId: string, sourceCardId: string, sourceCardScript: CardScript.ScriptData, targetCardId: string) {
            return this.beginGameDataTransaction(gameId, ['started'], async (gameData, broadcast) => {
                const playerState = GameEngineUtils.findPlayerByCardId(gameData, sourceCardId);
                if (playerState.id !== playerId) {
                    return;
                }
                const sourceCard = playerState.cards.find(x => x.id === sourceCardId)!;
                if (sourceCard.isUsed) {
                    return;
                }

                const targetCard = GameEngineUtils.findCardById(gameData, targetCardId);
                broadcast.push({
                    type: 'playerCardExecuting',
                    playerId,
                    sourceCardId,
                    sourceCardScript,
                    targetCardId,
                });
                const script = CardScript.deserialize(sourceCardScript, sourceCard);
                script.execute(gameData, sourceCard, targetCard, broadcast);

                sourceCard.isUsed = true;
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

        async _createPlayerState(playerId: string, cardIds: string[]): Promise<GameEngine.IPlayerState> {
            const cards = (await Promise.all(cardIds.map(ExtDeps.getNft)))
                .filter((resp): resp is NonNullable<typeof resp> => !!resp?.nft)
                .map(resp => appraiseCard(resp.nft));

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
                    sec: 0,
                    mods: [],
                    scripts: [],
                })),
                endedTurn: false,
            };
            for (const card of player.cards) {
                card.scripts = card.card.scripts.map(scriptName => CardScript.deserialize([scriptName], card).scriptData);
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
            }

            const playerCards = GameEngineUtils.getPlayerCards(gameData);
            for (const playerCard of playerCards) {
                playerCard.isUsed = false;
            }

            for (const playerCard of [...playerCards]) {
                if (!playerCards.includes(playerCard)) continue;
                GameEngineUtils.triggerMods(gameData, playerCard, 'onTurnStart', broadcast);
            }

            for (const enemy of gameData.enemies) {
                if (!gameData.enemies.includes(enemy)) continue;
                GameEngineUtils.triggerMods(gameData, enemy, 'onTurnStart', broadcast);
            }

            this._checkGameOver(gameData, broadcast);
        },

        _onEndTurn(gameData: GameEngine.IGameData, broadcast: IPlayerPushProvider.IPushMessage[]) {
            const playerCards = GameEngineUtils.getPlayerCards(gameData);
            for (const playerCard of playerCards) {
                if (!playerCards.includes(playerCard)) continue;
                GameEngineUtils.triggerMods(gameData, playerCard, 'onTurnEnd', broadcast);
            }

            broadcast.push({
                type: 'playerTurnEnded',
            });

            for (const enemy of gameData.enemies) {
                if (!gameData.enemies.includes(enemy)) continue;
                GameEngineUtils.triggerMods(gameData, enemy, 'onTurnEnd', broadcast);
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