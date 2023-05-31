import * as moment from 'moment';
import { createCoopHandler } from './apis/coop.api';
import { IAuthProvider, IDataSource, IPlayerPushProvider, IRateLimitProvider } from './dependencies';
import { CardMod } from './game/card-mods';
import { CardScript } from './game/card-scripts';
import { GameEngine, createGameEngineProvider } from './game/game-engine';
import { GameEngineUtils } from './game/game-engine-utils';
import { IHttpRequest, IHttpRouteHandler, StatusCodes } from './net-utils';
import { FULL_DATETIME_FORMAT } from './utils';

/**
 * Main entry point
 */
// TODO: this should be replaced with node:http or expressjs
export const handleRequest = async (req: IHttpRequest) => {
    const split = req.path.split('/').filter(Boolean);

    const subPath = split.slice(1);
    const body = req.body ? JSON.parse(req.body) : null;
    const query = req.queryStringParameters || {};

    let handler: IHttpRouteHandler | undefined = undefined;

    switch (split[0]) {
        case 'coop':
            handler = coopHandler;

        // ... Note: implement remaining route handlers
    }

    const result = handler ? (await handler(subPath, query, body, req)) : null;
    return result || [StatusCodes.badRequest, { reason: 'invalid api' }];
};


/**
 * Dependencies
 */

// Note: replace with an actual database
const cardDecksTable = createMockTableDualKey<IDataSource.ICardDeck>('playerId', 'createdAt');
const coopGamesTable = createMockTableSingleKey<IDataSource.ICoopGame>('id');
const playersTable = createMockTableSingleKey<IDataSource.IPlayer>('id');
const playerCoopGamesTable = createMockTableSingleKey<IDataSource.IPlayerCoopGame>('playerId');
const dataSource: IDataSource = {
    CardDecks: {
        ...cardDecksTable,
        async queryByDid(did) {
            return { items: [...cardDecksTable._db.values()].filter(x => x.playerId === did) };
        },
    },
    CoopGames: {
        ...coopGamesTable,
        async queryByGameState(gameState) {
            return { items: [...coopGamesTable._db.values()].filter(x => x.gameState === gameState) };
        },
    },
    GameData: {
        ...createMockTableSingleKey<GameEngine.IGameData>('id'),
    },
    Players: {
        ...playersTable,
    },
    PlayerCoopGames: {
        ...playerCoopGamesTable,
        async queryByPlayerId(playerId: string) {
            return { items: [...playerCoopGamesTable._db.values()].filter(x => x.playerId === playerId) };
        },
    },
    Leaderboard: {
        getTopN(_n) { return [] as any; },
        async set(_playerId, _score) { },
    },

    async execUpdates(...updateRequests) {
        updateRequests.forEach(x => x());
    },
};

// Note: replace with an actual auth provider
const authProvider: IAuthProvider = {
    generateNewSecret: () => `${Math.random()}`,
    getAuthTokenForPlayer: player => player.secret,
    getPlayerFromRequest: async () => [...playersTable._db.values()][0]!,
    getPlayerIdFromRequest: () => [...playersTable._db.values()][0]?.id!,
};

// Note: replace with an actual push provider
const pushProvider: IPlayerPushProvider = {
    async push(playerId, messages) {
        console.log(`Push messages for player [${playerId}]:`);
        messages.forEach(x => console.log(x));
    }
};

const rateLimitProvider: IRateLimitProvider = {
    async shouldRateLimitCreateGame(_playerId) {
        return false;
    },
    async shouldRateLimitSearchGame(_playerId) {
        return false;
    },
};

// Note: replace with custom game content
const gameContent: GameEngine.IRuleset = {
    cardMods: { /** Custom card modifiers **/ },
    cardScripts: { /** Custom card scripts **/ },

    initGame(engine) {
        const testEnemy: GameEngine.IEnemyCardState = {
            id: engine.nextId(),
            enemyClass: 'testEnemy',
            cpu: 1,
            mem: 1,
            maxMem: 1,
            mods: [],
            scripts: [],
            sec: 10,
        };
        testEnemy.mods.push(new CardMod.Content._standardAi().serialize());
        testEnemy.scripts.push(new CardScript.Content._attack(testEnemy, engine.gameData.difficulty).serialize());
        GameEngineUtils.addEnemy(engine, testEnemy, 0, true);
    },

    addAdditionalScriptsFor(_card) {
        // Note: Called by GameEngine when a player is joined; this hook allows for dynamic scripts for a given card
    },
};

const gameEngine = createGameEngineProvider({ mfrm: gameContent }, dataSource, pushProvider);
const coopHandler = createCoopHandler(dataSource, gameEngine, authProvider, rateLimitProvider);


/**
 * Example
 */
(async () => {
    /**
     * Players are normally created via /players/connectDid; to keep this example concise,
     * we'll inject one with CO8's DID into the mock database.
     */
    const mockPlayer = {
        id: 'did:chia:1sc5hxvcs26e4zsc7uvlfuc7x9sjj5aw6cu0g8vcyvscy49ffp8zqwh63tq',

        activeDeckId: '',
        activeGameId: '',
        secret: '',
        authExpiresAt: '2100-01-01',
        createdAt: moment.utc().format(FULL_DATETIME_FORMAT),
        lastSeenAt: moment.utc().format(FULL_DATETIME_FORMAT),
        score: 0,
    }
    playersTable._db.set(mockPlayer.id, mockPlayer);

    /**
     * This calls into /coop/create which is a complex API.
     * Step thru this to learn about how the route handlers work.
     */
    console.log('Creating game...');
    await handleRequest({
        httpMethod: 'POST',
        path: '/coop/create',
        body: JSON.stringify({
            gameVisibility: 'private',
            difficulty: 1,
        }),
    });
    console.log('Game created, gameId: ' + mockPlayer.activeGameId);

    /**
     * Games normally start automatically when enough players join via /coop/join or /coop/search,
     * to keep this example concise, we'll start it directly via the gameEngine reference.
     * Step thru this to learn about how the game engine works.
     */
    console.log('Starting game...');
    await gameEngine.startGame(mockPlayer.activeGameId);
})();


/**
 * In-memory DB helpers
 * Note: this is a mock database that only satisfies the example above and is
 * not meant to be starting point for production.
 */
function createMockTableSingleKey<T extends Record<string, any>>(idKey: keyof T) {
    const _db = new Map<string, T>();
    return {
        _db,

        async get(id: string) {
            return _db.get(id) || null;
        },
        update: {
            make(item: T) {
                return () => this.exec(item);
            },
            async exec(item: T) {
                _db.set(item[idKey], item);
                return item;
            },
        },
    };
}

function createMockTableDualKey<T extends Record<string, any>>(id1Key: keyof T, id2Key: keyof T) {
    const _db = new Map<string, T>();
    return {
        _db,

        async get(id1: string, id2: string) {
            return _db.get(`${id1}_${id2}`) || null;
        },
        update: {
            make(item: T) {
                return () => this.exec(item);
            },
            async exec(item: T) {
                _db.set(`${item[id1Key]}_${item[id2Key]}`, item);
                return item;
            },
        },
    };
}
