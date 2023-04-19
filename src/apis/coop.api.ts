import { randomBytes } from 'crypto';
import * as moment from 'moment';
import { z } from 'zod';
import { IAuthProvider, IDataSource } from '../dependencies';
import { GameEngine } from '../game/game-engine';
import { toClientPlayer } from '../models';
import { IHttpRequest, IHttpRouteHandler, RouteError, StatusCodes } from '../net-utils';
import { DATE_FORMAT, FULL_DATETIME_FORMAT } from '../utils';
import { getOrCreateActiveDeck } from './decks.api';

export const createCoopHandler = (ds: IDataSource, gameEngine: GameEngine, authProvider: IAuthProvider): IHttpRouteHandler => {
    return async function handler(path, _query, body, req): ReturnType<IHttpRouteHandler> {
        switch (path[0]) {
            case 'create': {
                const player = await _expectAuthPlayerNotInGame(req);
                const deck = await _expectValidActiveDeck(player);

                const now = moment.utc();
                const game: IDataSource.ICoopGame = {
                    id: randomBytes(16).toString('hex'),
                    createdAt: now.format(FULL_DATETIME_FORMAT),
                    difficulty: 1,
                    playersIds: new Set([player.id]),
                    gameState: 'open',
                    startedAt: '',
                    endedAt: '',
                    ingorePlayerIds: new Set(),
                    isCompleted: false,
                    _dbTtl: moment.utc(now).add({ days: 1 }).unix(),
                };

                await gameEngine.createGame(game.id, player.id, [...deck.cards.keys()]);

                player.activeGameId = game.id;
                await ds.execUpdates(
                    ds.CoopGames.update.make(game),
                    ds.Players.update.make(player),
                );

                return [StatusCodes.ok, { player: toClientPlayer(player, authProvider), status: 'gamecreated' }];
            }

            case 'join': {
                const schema = z.object({
                    gameId: z.string().nonempty(),
                });

                const payload = schema.parse(body);

                const player = await _expectAuthPlayerNotInGame(req);
                const deck = await _expectValidActiveDeck(player);
                const game = await _expectCoopGameJoinable(payload.gameId);

                await gameEngine.addPlayer(game.id, player.id, [...deck.cards.keys()]);

                player.activeGameId = game.id;
                game.playersIds.add(player.id);
                game.ingorePlayerIds.delete(player.id);
                game.gameState = game.playersIds.size >= 2 ? 'full' : game.gameState;
                await ds.execUpdates(
                    ds.Players.update.make(player),
                    ds.CoopGames.update.make(game),
                );

                if (!game.startedAt && game.gameState === 'full') {
                    await _onGameStart(game);
                }

                return [StatusCodes.ok, { player: toClientPlayer(player, authProvider), status: 'gamejoined' }];
            }

            case 'leave': {
                const { player, game } = await _expectAuthPlayerInGame(req);

                player.activeGameId = '';
                game.playersIds.delete(player.id);
                game.gameState = game.playersIds.size >= 2 ? 'full' : 'open';
                game.ingorePlayerIds.add(player.id);
                await ds.execUpdates(
                    ds.Players.update.make(player),
                    ds.CoopGames.update.make(game),
                );

                try {
                    await gameEngine.removePlayer(game.id, player.id, 'leave');
                } catch {
                    // Respect the player's request to leave even if the gameData couldn't be updated for some reason
                }

                if (!game.playersIds.size) {
                    await _onGameEnd(game);
                }

                return [StatusCodes.ok, { player: toClientPlayer(player, authProvider) }];
            }

            case 'search': {
                const player = await _expectAuthPlayerNotInGame(req);
                await _expectValidActiveDeck(player);

                const games = (await ds.CoopGames.queryByGameState('open', 50)).items;
                for (const game of games) {
                    if (game.playersIds.size < 2 && !game.ingorePlayerIds.has(player.id)) {
                        const gameData = await ds.GameData.get(game.id);
                        if (!gameData) {
                            await _onGameEnd(game);
                            continue;
                        }
                        return await handler(['join'], {}, { gameId: game.id }, req);
                    }
                }
                return await handler(['create'], {}, {}, req);
            }
        }
        return;
    }


    async function _onGameStart(game: IDataSource.ICoopGame) {
        await gameEngine.startGame(game.id);

        const now = moment.utc();
        game.startedAt = now.format(FULL_DATETIME_FORMAT);
        game._dbTtl = 9999999999;
        await ds.CoopGames.update.exec(game);
    }

    async function _onGameEnd(game: IDataSource.ICoopGame) {
        const playerUpdates = (await Promise.all([...game.playersIds].map(async playerId => {
            const player = await ds.Players.get(playerId);
            if (!player) {
                console.error(`_onGameEnd: player ${playerId} in ${game.id} not found`);
                return;
            }
            if (player.activeGameId === game.id) {
                player.activeGameId = '';
                return ds.Players.update.make(player, true);
            }
        }))).filter(Boolean);

        const now = moment.utc();
        game.gameState = `ended_${now.format(DATE_FORMAT)}`;
        game.endedAt = now.format(FULL_DATETIME_FORMAT);

        await ds.execUpdates(
            ...playerUpdates,
            ds.CoopGames.update.make(game),
        );

        try {
            await gameEngine.endGame(game.id);
        } catch {
        }
    }

    async function _expectAuthPlayerInGame(req: IHttpRequest) {
        const player = await authProvider.getPlayerFromRequest(req);
        if (!player.activeGameId) throw new RouteError(StatusCodes.forbidden, 'player has no active game id');

        const game = await ds.CoopGames.get(player.activeGameId);
        if (game) {
            return {
                player,
                game,
            };
        }

        player.activeGameId = '';
        await ds.Players.update.exec(player);
        throw new RouteError(StatusCodes.forbidden, 'player is not in game');
    }

    async function _expectAuthPlayerNotInGame(req: IHttpRequest) {
        const player = await authProvider.getPlayerFromRequest(req);
        if (player.activeGameId) throw new RouteError(StatusCodes.forbidden, 'player has an active game id');
        return player;
    }

    async function _expectCoopGameJoinable(gameId: string) {
        const game = await ds.CoopGames.get(gameId);
        if (!game) throw new RouteError(StatusCodes.forbidden, 'game not found');
        if (game.playersIds.size >= 2) throw new RouteError(StatusCodes.forbidden, 'game is full');
        if (game.endedAt) throw new RouteError(StatusCodes.forbidden, 'game has ended');
        return game;
    }

    async function _expectValidActiveDeck(player: IDataSource.IPlayer) {
        const deck = await getOrCreateActiveDeck(player, ds);
        if (!deck) throw new RouteError(StatusCodes.forbidden, 'player has no active deck');
        return deck;
    }
};