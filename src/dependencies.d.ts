import { GameEngine } from './game/game-engine';
import { IHttpRequest } from './net-utils';

declare namespace IDataSource {
    export type GetterSingle<MODEL> = (id: string) => Promise<MODEL | null>;
    export type GetterPair<MODEL> = (id1: string, id2: string) => Promise<MODEL | null>;

    export type UpdateRequest = any;
    export type Updater<MODEL> = {
        /**
         * Creates an UpdateRequest for the specified item that can be used with execUpdates(...).
         */
        make(item: MODEL, overwrite?: boolean): UpdateRequest;

        /**
         * Updates the specified item. Fails if the specified item has changed since it was retrieved if `overwrite` is true.
         */
        exec(item: MODEL, overwrite?: boolean): Promise<typeof item>;
    };

    export type Query<KEY, MODEL> = (key: NonNullable<KEY>, limit?: number, ct?: string) => Promise<{ items: MODEL[]; ct?: typeof ct; }>;

    export interface ICardDeck {
        readonly playerId: string;
        readonly createdAt: string;
        cards: { nftId: string, mintHeight: number, url: string }[];
        label: string;
    }
    export type CardDecks = {
        get: GetterPair<ICardDeck>;
        update: Updater<ICardDeck>;
        queryByDid: Query<ICardDeck['playerId'], ICardDeck>;
    };


    export interface ICoopGame {
        id: string;
        difficulty: number;
        createdAt: string;
        gameState: 'open' | 'private' | `ended_${string}`;
        playersIds: Set<string>;
        ingorePlayerIds: Set<string>;
        startedAt: string;
        endedAt: string;
        isCompleted: boolean;
        _dbTtl?: number;
    }
    export type CoopGames = {
        get: GetterSingle<ICoopGame>;
        update: Updater<ICoopGame>;
        queryByGameState: Query<ICoopGame['gameState'], ICoopGame>;
    };


    export interface IPlayer {
        id: string;
        createdAt: string;
        lastSeenAt: string;
        secret: string;
        authExpiresAt: string;
        activeGameId: string;
        activeDeckId: string;
        score: number;
    }
    export type Players = {
        get: GetterSingle<IPlayer>;
        update: Updater<IPlayer>;
    };


    export interface IPlayerCoopGame {
        playerId: string;
        endedAt: string;
        gameId: string;
        gameResult: 'win' | 'loss' | 'abandoned' | 'unknown';
        teammates: string[];
        score: number;
        turns: number;
        difficulty: number;
        rulesetIds: string[];
    }
    export type PlayerCoopGame = {
        update: Updater<IPlayerCoopGame>;
        queryByPlayerId: Query<string, IPlayerCoopGame>;
    }


    export type GameData = {
        get: GetterSingle<GameEngine.IGameData>;
        update: Updater<GameEngine.IGameData>;
    };


    export type Leaderboard = {
        getTopN(n: number): Promise<[string, number][]>;
        set(playerId: string, score: number): Promise<void>;
    };
}
declare interface IDataSource {
    CardDecks: IDataSource.CardDecks;
    CoopGames: IDataSource.CoopGames;
    GameData: IDataSource.GameData;
    Leaderboard: IDataSource.Leaderboard;
    PlayerCoopGames: IDataSource.PlayerCoopGame;
    Players: IDataSource.Players;

    /**
     * Transactionlly executes all UpdateRequests; no changes are made if any one of the UpdateRquests fail.
     */
    execUpdates(...updateRequests: IDataSource.UpdateRequest[]): Promise<void>;
}


declare interface IAuthProvider {
    generateNewSecret(): string;
    getAuthTokenForPlayer(player: IDataSource.IPlayer): string;
    getPlayerFromRequest(req: IHttpRequest): Promise<IDataSource.IPlayer>;
    getPlayerIdFromRequest(req: IHttpRequest): string;
}


declare namespace IPlayerPushProvider {
    export interface IPushMessage {
        [key: string]: any;
        type: string;
    }
}
declare interface IPlayerPushProvider {
    push(playerId: string, messages: IPlayerPushProvider.IPushMessage[]): Promise<void>;
}


declare interface IRateLimitProvider {
    shouldRateLimitCreateGame(playerId: string): Promise<boolean>;
    shouldRateLimitSearchGame(playerId: string): Promise<boolean>;
}


declare interface IMetricsProvider {
    userPresence(playerId: string): void;
    httpRequest(path: string, status: number): void;
    wsRequest(api: string, isSuccess: boolean): void;

    newUser(playerId: string): void;
    deckUpdated(playerId: string, deckId: string): void;
    nftOwnershipConflict(playerId: string): void;
    gameCreated(gameId: string, playerId: string, initialRulesetId: string, visibility: string, difficulty: number): void;
    gameStarted(gameId: string, initialRulesetId: string, players: string[], fromMatchmaking: boolean): void;
    gameJoined(gameId: string, midGame: boolean): void;
    gameEnded(gameId: string, result: string, rulesets: string[], players: string[], turns: number, totalScore: number): void;
    playerCardPlayed(gameId: string, currentRulesetId: string, playerId: string, card: GameEngine.IPlayerCardState, scriptName: string): void;
    idlePlayerRemoved(gameId: string, idlePlayerId: string): void;

    flush(): Promise<void>;
}