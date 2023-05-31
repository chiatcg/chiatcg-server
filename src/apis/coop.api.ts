import { randomBytes } from 'crypto';
import * as moment from 'moment';
import { z } from 'zod';
import { appraiseCard } from '../appraise';
import { IAuthProvider, IDataSource, IMetricsProvider, IRateLimitProvider } from '../dependencies';
import { ExtDeps } from '../external-dependencies';
import { GameEngine, GameEngineProvider } from '../game/game-engine';
import { toClientPlayer } from '../models';
import { IHttpRequest, IHttpRouteHandler, RouteError, StatusCodes } from '../net-utils';
import { DATE_FORMAT, FULL_DATETIME_FORMAT } from '../utils';
import { getOrCreateActiveDeck } from './decks.api';

export const createCoopHandler = (ds: IDataSource, gameEngineProvider: GameEngineProvider, authProvider: IAuthProvider, rateLimit: IRateLimitProvider, metrics?: IMetricsProvider): IHttpRouteHandler => {
    return async function handler(path, query, body, req): ReturnType<IHttpRouteHandler> {
        switch (path[0]) {
            case 'create': {
                const schema = z.object({
                    gameVisibility: z.union([z.literal('public'), z.literal('private'), z.literal('solo')]),
                    difficulty: z.number(),
                });

                const payload = schema.parse(body);

                const player = await _expectAuthPlayerNotInGame(req);
                const deck = await _expectValidActiveDeck(player, true);

                if (await rateLimit.shouldRateLimitCreateGame(player.id)) {
                    return [StatusCodes.tooManyRequests];
                }

                const now = moment.utc();
                const game: IDataSource.ICoopGame = {
                    id: randomBytes(16).toString('hex'),
                    createdAt: now.format(FULL_DATETIME_FORMAT),
                    difficulty: payload.difficulty,
                    playersIds: new Set([player.id]),
                    gameState: payload.gameVisibility === 'public' ? 'open' : 'private',
                    startedAt: '',
                    endedAt: '',
                    ingorePlayerIds: new Set(),
                    isCompleted: false,
                    _dbTtl: moment.utc(now).add({ days: 1 }).unix(),
                };

                const initialRulesetId = 'mfrm';
                metrics?.gameCreated(game.id, player.id, initialRulesetId, payload.gameVisibility, payload.difficulty);

                await gameEngineProvider.createGame(game.id, initialRulesetId, payload.difficulty);
                await gameEngineProvider.addPlayer(game.id, player.id, deck.cards.map(x => x.nftId));
                if (payload.gameVisibility === 'solo') {
                    await _onGameStart(game, false);
                }

                player.activeGameId = game.id;
                await ds.execUpdates(
                    ds.CoopGames.update.make(game),
                    ds.Players.update.make(player),
                );

                return [StatusCodes.ok, { player: toClientPlayer(player, authProvider), status: 'gamecreated' }];
            }

            case 'history': {
                const playerId = authProvider.getPlayerIdFromRequest(req);
                const games = await ds.PlayerCoopGames.queryByPlayerId(playerId, +(query.count || 10), query.ct ? `${query.ct}` : undefined);
                return [StatusCodes.ok, games];
            }

            case 'join': {
                const schema = z.object({
                    teammateDid: z.string().nonempty(),
                    fromMatchmaking: z.boolean().optional(),
                });

                const payload = schema.parse(body);

                const [player, teammate] = await Promise.all([
                    _expectAuthPlayerNotInGame(req),
                    ds.Players.get(payload.teammateDid),
                ]);

                if (!teammate?.activeGameId) {
                    return [StatusCodes.notFound];
                }

                const [deck, game] = await Promise.all([
                    _expectValidActiveDeck(player, true),
                    _expectCoopGameJoinable(teammate.activeGameId),
                ]);

                const gameData = await gameEngineProvider.addPlayer(game.id, player.id, deck.cards.map(x => x.nftId));

                player.activeGameId = game.id;
                game.playersIds.add(player.id);
                game.ingorePlayerIds.delete(player.id);
                await ds.execUpdates(
                    ds.Players.update.make(player),
                    ds.CoopGames.update.make(game),
                );

                if (!game.startedAt && game.playersIds.size >= 2) {
                    await _onGameStart(game, !!payload.fromMatchmaking);
                }

                metrics?.gameJoined(game.id, gameData.turn >= 2);
                return [StatusCodes.ok, { player: toClientPlayer(player, authProvider), status: 'gamejoined' }];
            }

            case 'leave': {
                const { player, game } = await _expectAuthPlayerInGame(req);

                player.activeGameId = '';
                if (!game.gameState.startsWith('ended')) {
                    game.playersIds.delete(player.id);
                    game.ingorePlayerIds.add(player.id);
                }

                await ds.execUpdates(
                    ds.Players.update.make(player),
                    ds.CoopGames.update.make(game),
                );

                try {
                    const gameData = await gameEngineProvider.getGameData(game.id);
                    const playerState = gameData.players.get(player.id);
                    if (!game.gameState.startsWith('ended') && playerState && gameData.state !== 'created' && gameData.turn > 1) {
                        const now = moment.utc().format(FULL_DATETIME_FORMAT);
                        await ds.PlayerCoopGames.update.exec({
                            playerId: player.id,
                            endedAt: now,
                            gameId: game.id,
                            gameResult: _getGameResult(gameData),
                            score: playerState.score,
                            teammates: _getOtherPlayerIds(player.id, game),
                            turns: gameData.turn,
                            difficulty: gameData.difficulty,
                            rulesetIds: gameData.rulesetIds,
                        }, true);
                    }
                } catch (e: any) {
                    console.error(e);
                }

                try {
                    await gameEngineProvider.removePlayer(game.id, player.id, 'leave');
                } catch {
                    // Respect the player's request to leave even if the gameData couldn't be updated for some reason
                }

                if (!game.playersIds.size) {
                    await finalizeGame(game.id, true, ds, gameEngineProvider, metrics);
                }

                return [StatusCodes.ok, { player: toClientPlayer(player, authProvider) }];
            }

            case 'rankings': {
                const rankings = await ds.Leaderboard.getTopN(20);
                return [StatusCodes.ok, { rankings }];
            }

            case 'search': {
                const player = await _expectAuthPlayerNotInGame(req);

                // Don't need to validate nft ownership yet, either join() or create() will do this
                const deck = await _expectValidActiveDeck(player, false);

                let ct: any = undefined;
                do {
                    const result = await ds.CoopGames.queryByGameState('open', 10, ct);
                    const games = result.items.sort((a, b) => a.ingorePlayerIds.size - b.ingorePlayerIds.size);

                    for (const game of games) {
                        if (game.playersIds.size < 2 && !game.ingorePlayerIds.has(player.id)) {
                            const gameData = await ds.GameData.get(game.id);

                            if (!gameData || !game.playersIds.size) {
                                // GameData already TTL'd this is a dead session
                                await finalizeGame(game.id, true, ds, gameEngineProvider, metrics);
                                continue;
                            }

                            if (gameData.players.size >= 2 || (gameData.state !== 'created' && gameData.state !== 'started')) {
                                // Game is full or not in a joinable state
                                continue;
                            }

                            if (await rateLimit.shouldRateLimitSearchGame(player.id)) {
                                return [StatusCodes.tooManyRequests];
                            }
                            return await handler(['join'], {}, { teammateDid: [...gameData.pendingPlayers.keys()][0] || [...gameData.players.keys()][0], fromMatchmaking: true }, req);
                        }
                    }

                    ct = result.ct;
                } while (ct);

                // No joinable game found - proceed to create a public game

                const difficulty = body?.difficulty || (1 + (deck.cards.map(appraiseCard).reduce((sum, x) => sum + x.tier, 0) / deck.cards.length) | 0);

                return await handler(['create'], {}, { gameVisibility: 'public', difficulty }, req);
            }

            case 'start': {
                const { game } = await _expectAuthPlayerInGame(req);
                const gameData = await ds.GameData.get(game.id);
                if (gameData?.state !== 'created') {
                    return [StatusCodes.forbidden];
                }

                await _onGameStart(game, false);

                return [StatusCodes.ok];
            }
        }
        return;
    }


    async function _onGameStart(game: IDataSource.ICoopGame, fromMatchmaking: boolean) {
        const gameData = await gameEngineProvider.startGame(game.id);

        const now = moment.utc();
        game.startedAt = now.format(FULL_DATETIME_FORMAT);
        game._dbTtl = 9999999999;
        await ds.CoopGames.update.exec(game);

        metrics?.gameStarted(game.id, gameData.rulesetIds[0] || 'unknown', [...gameData.players.keys()], fromMatchmaking);
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

    async function _expectValidActiveDeck(player: IDataSource.IPlayer, validateNftOwnership: boolean) {
        const deck = await getOrCreateActiveDeck(player, ds);
        if (!deck) throw new RouteError(StatusCodes.forbidden, 'player has no active deck');

        if (validateNftOwnership) {
            const nfts = await Promise.all(deck.cards.map(x => ExtDeps.getNft(x.nftId)));
            if (nfts.find(x => !x || x.nft.did !== player.id)) {
                metrics?.nftOwnershipConflict(player.id);
                throw new RouteError(StatusCodes.conflict, 'some cards do not belong to the did');
            }
        }

        return deck;
    }
};


export async function finalizeGame(gameId: string, removePlayers: boolean, ds: IDataSource, gameEngineProvider: GameEngineProvider, metrics?: IMetricsProvider) {
    const game = await ds.CoopGames.get(gameId);
    if (!game) throw new Error('game not found: ' + gameId);
    if (game.gameState.startsWith('ended')) return;


    const now = moment.utc();
    game.gameState = `ended_${now.format(DATE_FORMAT)}`;
    game.endedAt = now.format(FULL_DATETIME_FORMAT);
    let gameData: GameEngine.IGameData | undefined = undefined;

    let gameResult: IDataSource.IPlayerCoopGame['gameResult'] = 'unknown';
    try {
        gameData = await gameEngineProvider.getGameData(game.id);
        gameResult = _getGameResult(gameData);
    } catch { }

    metrics?.gameEnded(
        game.id,
        gameResult,
        gameData?.rulesetIds || [],
        [...game.playersIds], gameData?.turn || -1, [...gameData?.players.values() || []].reduce((sum, x) => sum + x.score, 0),
    );

    const playerUpdates = (await Promise.all([...game.playersIds].map(async playerId => {
        const player = await ds.Players.get(playerId);
        if (!player) {
            console.error(`_onGameEnd: player ${playerId} in ${game.id} not found`);
            return;
        }
        if (player.activeGameId === game.id) {
            removePlayers && (player.activeGameId = '');

            const playerState = gameData?.players.get(playerId);
            if (playerState?.score) {
                player.score += playerState?.score || 0;
                await ds.Leaderboard.set(player.id, player.score);
            }

            return [
                ds.PlayerCoopGames.update.make({
                    playerId,
                    endedAt: game.endedAt,
                    gameId: game.id,
                    gameResult,
                    score: playerState?.score || 0,
                    teammates: _getOtherPlayerIds(playerId, game),
                    turns: gameData?.turn || -1,
                    difficulty: game.difficulty,
                    rulesetIds: gameData?.rulesetIds || [],
                }, true),
                ds.Players.update.make(player, true),
            ];
        }
        return;
    }))).filter(Boolean).flat();

    await ds.execUpdates(
        ...playerUpdates,
        ds.CoopGames.update.make(game),
    );

    try {
        await gameEngineProvider.endGame(game.id);
    } catch {
    }
}

function _getGameResult(gameData: GameEngine.IGameData): IDataSource.IPlayerCoopGame['gameResult'] {
    switch (gameData.state) {
        case 'abandoned': return 'abandoned';
        case 'players_lost': return 'loss';
        case 'players_won': return 'win';
        case 'started': return 'abandoned';
        default:
            return 'unknown';
    }
}

function _getOtherPlayerIds(playerId: string, game: IDataSource.ICoopGame) {
    return [
        ...[...game.playersIds.keys()].filter(x => x !== playerId),
        // ...[...game.ingorePlayerIds.keys()].filter(x => x !== playerId),
    ];
}