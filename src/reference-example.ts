import * as moment from 'moment';
import { createCoopHandler } from './apis/coop.api';
import { IAuthProvider, IDataSource, IPlayerPushProvider } from './dependencies';
import { CardMod } from './game/card-mods';
import { CardScript } from './game/card-scripts';
import { GameEngine, createGameEngine } from './game/game-engine';
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

    const result = handler ? (await handler(subPath, body, query, req)) : null;
    return result || [StatusCodes.badRequest, { reason: 'invalid api' }];
};


/**
 * Dependencies
 */

// Note: replace with an actual database
const cardDecksTable = createMockTableDualKey<IDataSource.ICardDeck>('playerId', 'createdAt');
const coopGamesTable = createMockTableSingleKey<IDataSource.ICoopGame>('id');
const playersTable = createMockTableSingleKey<IDataSource.IPlayer>('id');
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
    async execUpdates(...updateRequests) {
        updateRequests.forEach(x => x());
    },
};

// Note: replace with an actual auth provider
const authProvider: IAuthProvider = {
    generateNewSecret: () => `${Math.random()}`,
    getAuthTokenForPlayer: player => player.secret,
    getPlayerFromRequest: async () => [...playersTable._db.values()][0]!,
};

// Note: replace with an actual push provider
const pushProvider: IPlayerPushProvider = {
    async push(playerId, messages) {
        console.log(`Push messages for player [${playerId}]:`);
        messages.forEach(x => console.log(x));
    }
};

// Note: replace with custom game content
const gameContent: GameEngine.IGameContentPlugin = {
    cardMods: [/** Custom card modifiers **/],
    cardScripts: [/** Custom card scripts **/],

    createFirstEnemy(id) {
        const testEnemy: GameEngine.IEnemyCardState = {
            id,
            enemyClass: 'testEnemy',
            cpu: 1,
            mem: 1,
            mods: [],
            scripts: [],
            sec: 10,
        };
        testEnemy.mods.push(new CardMod._standardAi().modData);
        testEnemy.scripts.push(new CardScript.bf_bruteforce(testEnemy, 50).scriptData);
        return testEnemy;
    },
    createEnemy(_enemyClass, id) {
        return this.createFirstEnemy(id);
    },
};

const gameEngine = createGameEngine(gameContent, dataSource, pushProvider);
const coopHandler = createCoopHandler(dataSource, gameEngine, authProvider);


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
