import * as moment from 'moment';
import { IAppraisedCard, appraiseCard } from '../appraise';
import { IDataSource, IMetricsProvider, IPlayerPushProvider } from '../dependencies';
import { ExtDeps } from '../external-dependencies';
import { SECS_IN_MIN } from '../utils';
import { CardMod } from './card-mods';
import { CardScript } from './card-scripts';
import { GameContent_v1 } from './game-content-v1';
import { GameEngineUtils } from './game-engine-utils';

export namespace GameEngine {
    interface _ICommonCardState {
        id: number;
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
        state: 'created' | 'started' | 'players_won' | 'players_lost' | 'abandoned';

        enemies: IEnemyCardState[];
        maxEnemies: number;
        players: Map<string, IPlayerState>;
        defaultMovesPerTurn: number;
        turn: number;
        nextId: number;
        pendingPlayers: Map<string, string[]>;
        rulesetIds: string[];
    }

    export interface IPlayerState {
        id: string;
        cards: IPlayerCardState[];
        endedTurn: boolean;
        idleKickTime: number;
        movesLeft: number;
        movesPerTurn: number;
        score: number;
        stats: {
            kills: number;
            secDmg: number;
            memDmg: number;
            secBonus: number;
        };
    }

    export interface IPlayerCardState extends _ICommonCardState {
        card: IAppraisedCard;
        isUsed: boolean;
    }

    export interface IEnemyCardState extends _ICommonCardState {
        enemyClass: string;
        intent?: { scriptData: CardScript.ScriptData, targetCardId: number };
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

    export interface IRulesetContent {
        cardMods?: CardMod.ModLibrary;
        cardScripts?: CardScript.ScriptLibrary;
        enemyCards?: Record<string, (engine: IGameEngine) => IEnemyCardState>;
    }

    export interface IRuleset extends IRulesetContent {
        initGame(engine: IGameEngine): void;
        addAdditionalScriptsFor?(engine: GameEngine.IGameEngine, card: IPlayerCardState): void;
    }

    export function mergeRulesetContents(...rulesets: IRulesetContent[]): IRulesetContent {
        const modLibs = rulesets.map(x => x.cardMods).filter(Boolean);
        const scriptLibs = rulesets.map(x => x.cardScripts).filter(Boolean);
        const enemyLibs = rulesets.map(x => x.enemyCards).filter(Boolean);
        return {
            cardMods: Object.fromEntries(modLibs.map(modLib => Object.keys(modLib).map(modName => [modName, modLib[modName]!] as const)).flat()),
            cardScripts: Object.fromEntries(scriptLibs.map(scriptLib => Object.keys(scriptLib).map(scriptName => [scriptName, scriptLib[scriptName]!] as const)).flat()),
            enemyCards: Object.fromEntries(enemyLibs.map(enemyLib => Object.keys(enemyLib).map(enemyClass => [enemyClass, enemyLib[enemyClass]!] as const)).flat()),
        };
    }

    export type IGameEngine = InstanceType<ReturnType<typeof createGameEngineProvider>>;
}

export const createGameEngineProvider = (rulesets: Record<string, GameEngine.IRuleset>, ds: IDataSource, playerPushProvider: IPlayerPushProvider, metrics?: IMetricsProvider) => {
    return class _Engine {
        readonly broadcast: IPlayerPushProvider.IPushMessage[] = [];
        ruleset!: GameEngine.IRuleset;

        constructor(
            readonly gameData: GameEngine.IGameData,
        ) {
            const currentRuleset = rulesets[gameData.rulesetIds.at(-1)!];
            if (!currentRuleset) throw new Error('invalid initial ruleSet id: ' + gameData.rulesetIds[0]);
            this._setRuleset(currentRuleset);
        }

        private static async _withEngine(gameId: string, stateAssertion: GameEngine.IGameData['state'][], func: (engine: _Engine) => Promise<void>): Promise<GameEngine.IGameData> {
            const gameData = await ds.GameData.get(gameId);
            if (!gameData) throw new GameEngine.GameNotFoundError(gameId);

            const engine = new _Engine(gameData);
            try {
                if (stateAssertion.length && !stateAssertion.includes(gameData.state)) throw new Error('wrong game state, expected: ' + stateAssertion.join() + ', got: ' + gameData.state);

                await func(engine);
                await ds.GameData.update.exec(gameData);
            } catch (e: any) {
                e.broadcast = engine.broadcast;
                throw e;
            }

            if (engine.broadcast.length) {
                await Promise.all(
                    [...gameData.players.keys()].map(playerId => playerPushProvider.push(playerId, engine.broadcast)),
                );
            }

            return gameData;
        }

        static async createGame(gameId: string, rulesetId: string, difficulty: number) {
            const ruleset = rulesets[rulesetId];
            if (!ruleset) throw new Error('invalid ruleSet id: ' + rulesetId);

            const existingGameData = await ds.GameData.get(gameId);
            if (existingGameData) throw new Error('game with id already exists: ' + gameId);

            const gameData: GameEngine.IGameData = {
                id: gameId,
                difficulty: Math.max(1, difficulty),
                state: 'created',
                turn: 1,
                players: new Map(),
                defaultMovesPerTurn: 3,
                enemies: [],
                maxEnemies: 9,
                nextId: 1,
                pendingPlayers: new Map(),
                rulesetIds: [rulesetId],
            };
            await ds.GameData.update.exec(gameData);
        }

        static async startGame(gameId: string) {
            const gameData = await _Engine._withEngine(gameId, ['created'], async engine => {
                for (const [playerId, cardIds] of engine.gameData.pendingPlayers) {
                    const playerState = await engine._createPlayerState(playerId, cardIds);
                    engine.gameData.players.set(playerId, playerState);
                    engine.broadcast.push({ type: 'playerJoin', playerState });
                }

                engine.gameData.pendingPlayers.clear();
                engine.gameData.state = 'started';
                engine.broadcast.push({ type: 'gameStart' });
                engine.ruleset.initGame(engine);
            });
            return gameData;
        }

        static async endGame(gameId: string) {
            return await _Engine._withEngine(gameId, ['created', 'started'], async engine => {
                engine.gameData.state = 'abandoned';
                engine.broadcast.push({ type: 'gameEnd' });
            });
        }

        static async addPlayer(gameId: string, playerId: string, cardIds: string[]) {
            return await _Engine._withEngine(gameId, ['created', 'started'], async engine => {
                if (engine.gameData.players.has(playerId)) throw new Error('player already in game');
                if (engine.gameData.players.size >= 2) throw new Error('game is full: ' + gameId);

                if (engine.gameData.state === 'started') {
                    const playerState = await engine._createPlayerState(playerId, cardIds);
                    engine.gameData.players.set(playerId, playerState);

                    if (engine.gameData.turn >= 2) {
                        playerState.endedTurn = true;
                        playerState.movesLeft = 0;
                    }

                    engine.broadcast.push({
                        type: 'playerJoin',
                        playerState,
                    });
                } else {
                    engine.gameData.pendingPlayers.set(playerId, cardIds);
                }
            });
        }

        static async removePlayer(gameId: string, playerId: string, reason: 'idle' | 'leave') {
            return await _Engine._withEngine(gameId, [], async engine => {
                if (!engine.gameData.players.delete(playerId)) throw new Error('player not found');
                engine.broadcast.push({ type: 'playerLeave', playerId, reason });
                GameEngineUtils.revalidateIntents(engine, true);

                for (const remainingPlayer of engine.gameData.players.values()) {
                    remainingPlayer.endedTurn = false;
                    engine.broadcast.push({
                        type: 'playerToggleEndTurn',
                        playerId: remainingPlayer.id,
                        state: false,
                    });
                }
            });
        }

        static async requestCardTargets(gameId: string, playerId: string, cardId: number, scriptName: string) {
            const gameData = await _Engine.getGameData(gameId);
            const card = GameEngineUtils.findPlayerCardById(gameData, cardId);
            let targets = [] as number[];
            try {
                if (card.isUsed) {
                    return;
                }

                const scriptData = card.scripts.find(x => x[0] === scriptName);
                if (!scriptData) {
                    throw new Error(`Script [${scriptName}] not found in card [${cardId}]`);
                }

                if (CardScript.isOnCooldown(scriptData)) {
                    return;
                }

                const engine = new _Engine(gameData);
                const script = CardScript.deserialize(engine, card, scriptData);
                targets = script.targetFinder(gameData, card).map(x => x.id);
            } finally {
                await playerPushProvider.push(playerId, [{
                    type: 'cardTargets',
                    cardId,
                    scriptName,
                    targetCardIds: targets,
                }]);
            }
        }

        static async intent(gameId: string, playerId: string, sourceCardId?: string, sourceCardScript?: string, targetCardId?: string) {
            const gameData = await _Engine.getGameData(gameId);
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
        }

        static async makeMove(gameId: string, playerId: string, sourceCardId: number, sourceCardScript: CardScript.ScriptData, targetCardId: number) {
            return await _Engine._withEngine(gameId, ['started'], async engine => {
                const playerState = GameEngineUtils.findPlayerByCardId(engine.gameData, sourceCardId);
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

                const now = moment.now();
                playerState.idleKickTime = now + 2 * SECS_IN_MIN * 1000;
                playerState.movesLeft--;

                const targetCard = GameEngineUtils.findCardById(engine.gameData, targetCardId);
                CardScript.execute(engine, sourceCard, sourceCardScript, targetCard);
                GameEngineUtils.changeCardIsUsed(engine, sourceCard, true);

                metrics?.playerCardPlayed(gameId, engine.gameData.rulesetIds[0] || 'unknown', playerId, sourceCard, sourceCardScript[0]);
            });
        }

        static async toggleEndTurn(gameId: string, playerId: string) {
            return await _Engine._withEngine(gameId, ['started'], async engine => {
                const playerState = engine.gameData.players.get(playerId);
                if (!playerState) throw new Error('player not found');

                if (playerState.endedTurn) {
                    playerState.endedTurn = false;
                    engine.broadcast.push({
                        type: 'playerToggleEndTurn',
                        playerId,
                        state: false,
                    });
                    return;
                }

                playerState.endedTurn = true;
                engine.broadcast.push({
                    type: 'playerToggleEndTurn',
                    playerId,
                    state: true,
                });

                if (![...engine.gameData.players.values()].reduce((numNotReady, playerState) => playerState.endedTurn ? numNotReady : (numNotReady + 1), 0)) {
                    const now = moment.now();
                    [...engine.gameData.players.values()].forEach(x => x.idleKickTime = now + 2 * SECS_IN_MIN * 1000);

                    engine.onEndTurn();
                    if (engine.gameData.state !== 'started') {
                        // Stop if the game was won/lost due to an EndTurn effect
                        return;
                    }
                    engine.onTurnStart();
                }
            });
        }

        static async kickTeammateIfIdle(gameId: string, kickRequestingPlayerId: string) {
            let kickedPlayerId = '';
            await _Engine._withEngine(gameId, ['started'], async engine => {
                const playerToKick = [...engine.gameData.players.values()].find(x => x.id !== kickRequestingPlayerId) || '';
                if (!playerToKick) throw new Error('kickIfIdle: player not found');

                if (playerToKick.idleKickTime < moment.now()) {
                    if (!engine.gameData.players.delete(playerToKick.id)) throw new Error('player not found');

                    engine.broadcast.push({ type: 'playerLeave', playerId: playerToKick.id, reason: 'idle' });
                    GameEngineUtils.revalidateIntents(engine, true);

                    for (const remainingPlayer of engine.gameData.players.values()) {
                        remainingPlayer.endedTurn = false;
                        engine.broadcast.push({
                            type: 'playerToggleEndTurn',
                            playerId: remainingPlayer.id,
                            state: false,
                        });
                    }

                    kickedPlayerId = playerToKick.id;
                }
            });
            return kickedPlayerId || null;
        }

        static async getGameData(gameId: string) {
            const gameData = await ds.GameData.get(gameId);
            if (!gameData) throw new GameEngine.GameNotFoundError(gameId);
            return gameData;
        }

        private async _createPlayerState(playerId: string, cardIds: string[]): Promise<GameEngine.IPlayerState> {
            const cards = (await Promise.all(cardIds.map(ExtDeps.getNft)))
                .filter((resp): resp is NonNullable<typeof resp> => !!resp?.nft)
                .map(resp => appraiseCard({ nftId: resp.nft.nftId, mintHeight: resp.nft.firstBlock, url: resp.nft.urls[0] || '' }));

            if (cards.length !== cardIds.length) {
                throw `could not resolve all cards for player ${playerId}`;
            }

            const player: GameEngine.IPlayerState = {
                id: playerId,
                cards: cards.map(card => ({
                    id: this.nextId(),
                    card,
                    isUsed: false,
                    cpu: card.cpu,
                    mem: card.mem,
                    sec: card.mem * 6 + card.cpu * 3,
                    mods: [],
                    scripts: [],
                })),
                endedTurn: false,
                movesLeft: this.gameData.defaultMovesPerTurn,
                movesPerTurn: this.gameData.defaultMovesPerTurn,
                stats: {
                    kills: 0,
                    memDmg: 0,
                    secBonus: 0,
                    secDmg: 0,
                },
                score: 0,
                idleKickTime: moment.now() + 2 * SECS_IN_MIN * 1000,
            };
            for (const card of player.cards) {
                card.scripts = [
                    CardScript.fromScriptName(this, card, card.card.coreScript),
                ];
                this.ruleset.addAdditionalScriptsFor && this.ruleset.addAdditionalScriptsFor(this, card);
            }
            return player;
        }

        findRuleset(rulesetId: string) {
            return rulesets[rulesetId];
        }

        onTurnStart() {
            this.gameData.turn++;
            this.broadcast.push({
                type: 'newTurn',
                turn: this.gameData.turn,
            });

            for (const player of this.gameData.players.values()) {
                player.endedTurn = false;
                player.movesLeft = player.movesPerTurn;
            }

            const playerCards = GameEngineUtils.getPlayerCards(this.gameData);
            for (const playerCard of playerCards) {
                GameEngineUtils.changeCardIsUsed(this, playerCard, false);
            }

            for (const playerCard of [...playerCards]) {
                if (!playerCards.includes(playerCard)) continue;
                GameEngineUtils.triggerMods('onTurnStart', { engine: this, sourceCard: playerCard });
            }

            for (const enemy of [...this.gameData.enemies]) {
                if (!this.gameData.enemies.includes(enemy)) continue;
                GameEngineUtils.triggerMods('onTurnStart', { engine: this, sourceCard: enemy });
            }

            this._checkGameOver();
        }

        onEndTurn() {
            const playerCards = GameEngineUtils.getPlayerCards(this.gameData);
            for (const playerCard of [...playerCards]) {
                if (!playerCards.includes(playerCard)) continue;
                GameEngineUtils.triggerMods('onTurnEnd', { engine: this, sourceCard: playerCard });
                CardScript.tickCooldowns(playerCard, this.broadcast);
            }

            this.broadcast.push({
                type: 'playerTurnEnded',
            });

            for (const enemy of [...this.gameData.enemies]) {
                if (!this.gameData.enemies.includes(enemy)) continue;
                GameEngineUtils.triggerMods('onTurnEnd', { engine: this, sourceCard: enemy });
                CardScript.tickCooldowns(enemy, this.broadcast);
            }

            this.broadcast.push({
                type: 'enemyTurnEnded',
            });

            this._checkGameOver();
        }

        onNextWave(nextRulesetId: string) {
            while (this.gameData.enemies[0]) {
                GameEngineUtils.removeCard(this, this.gameData.enemies[0]);
            }

            [...this.gameData.players.values()].forEach(player => {
                player.endedTurn = false;
                player.movesLeft = player.movesPerTurn;
                player.cards.forEach(card => {
                    card.isUsed = false;
                });
            });

            this.gameData.turn++;
            this.broadcast.push({
                type: 'nextWave',
                turn: this.gameData.turn,
                nextRulesetId,
            });

            const nextRuleset = this.findRuleset(nextRulesetId);
            if (!nextRuleset) {
                throw new Error('invalid rulesetId: ' + nextRulesetId);
            }

            this.gameData.rulesetIds.push(nextRulesetId);
            this._setRuleset(nextRuleset);
            nextRuleset.initGame(this);
        }

        onWinGame() {
            this.gameData.state = 'players_won';

            this.broadcast.push({
                type: 'players_won',
                stats: [...this.gameData.players.values()].map(player => {
                    let score =
                        player.cards.length * 50
                        + player.stats.kills * 25
                        + player.stats.memDmg * 50
                        + player.stats.secDmg
                        + player.stats.secBonus * 2
                        + ((this.gameData.rulesetIds.length - 1) * 2000);
                    score = GameEngineUtils.scaleByDifficulty(score, this.gameData.difficulty + 1);
                    player.score = score;

                    return { playerId: player.id, stats: player.stats, score };
                }),
            });
        }

        nextId() {
            return this.gameData.nextId++;
        }

        private _checkGameOver() {
            if (!GameEngineUtils.getPlayerCards(this.gameData).length) {
                this.gameData.state = 'players_lost';
                this.broadcast.push({
                    type: 'players_lost',
                });
            }
        }

        private _setRuleset(nextRuleset: GameEngine.IRuleset) {
            this.ruleset = {
                addAdditionalScriptsFor: GameContent_v1.addAdditionalScriptsFor,

                ...nextRuleset,

                ...GameEngine.mergeRulesetContents(
                    nextRuleset,
                    {
                        cardMods: CardMod.Content,
                        cardScripts: CardScript.Content,
                    },
                    {
                        cardMods: GameContent_v1.cardMods,
                        cardScripts: GameContent_v1.cardScripts,
                        enemyCards: GameContent_v1.enemyCards,
                    }
                ),
            };
        }
    }
}
export type GameEngineProvider = ReturnType<typeof createGameEngineProvider>;