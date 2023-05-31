import { randInt } from '../../utils';
import { CardMod } from '../card-mods';
import { CardScriptParts } from '../card-script-parts';
import { CardScript } from '../card-scripts';
import { GameContent_v1 } from '../game-content-v1';
import { GameEngine } from '../game-engine';
import { GameEngineUtils } from '../game-engine-utils';

export const RulesetReaper = {
    cardMods: {
        reaper_feederCorrupted: class extends CardMod {

        },

        reaper_feederPower: class extends CardMod {
            override onSecDamageIn(deps: CardMod.ICardModDeps, damage: number, attacker: GameEngine.ICardState) {
                if (deps.sourceCard.sec - damage > 0) return;

                GameEngineUtils.changeSec(deps.engine, deps.sourceCard, -deps.sourceCard.sec, true);
                CardMod.removeModByName(deps.engine, deps.sourceCard, this.constructor.name, attacker);
                CardMod.addMod(deps.engine, deps.sourceCard, new RulesetReaper.cardMods.reaper_feederCorrupted(), attacker);
                CardMod.addMod(deps.engine, deps.sourceCard, new CardMod.Content.impervious(), attacker);

                const player = GameEngineUtils.findPlayerByCardIdMaybe(deps.engine.gameData, attacker.id);
                player && player.stats.kills++;

                return { secDmgBonus: -9999 };
            }
        },
    },

    cardScripts: {
        reaper_bossEat: class extends CardScript {
            constructor(_card: GameEngine.ICardState) {
                super(
                    [],
                    (gameData, _card) => {
                        return gameData.enemies.filter(x => x.enemyClass === RulesetReaper.enemyCards.reaper_feeder.name);
                    },
                    [
                        {
                            targetResolver: CardScript.TargetResolvers.Target,
                            parts: [
                                (engine, source, target) => {
                                    GameEngineUtils.removeCard(engine, target, source);

                                    if (target.mods.find(x => x[0] === RulesetReaper.cardMods.reaper_feederCorrupted.name)) {
                                        GameEngineUtils.changeSec(engine, source, -50, false);
                                        if (source.sec <= 0) {
                                            GameEngineUtils.removeCard(engine, source);
                                            return;
                                        }
                                    } else {
                                        GameEngineUtils.changeSec(engine, source, Math.round(target.sec / 2), false);
                                        GameEngineUtils.changeCpu(engine, source, 1);
                                        for (const guardian of engine.gameData.enemies.filter(x => x.enemyClass === RulesetReaper.enemyCards.reaper_guardian.name)) {
                                            CardMod.addMod(engine, guardian, new GameContent_v1.cardMods.optimized(1, -1));
                                        }
                                    }

                                    const highDiff = engine.gameData.difficulty >= 7;
                                    if (engine.gameData.enemies.length <= (highDiff ? 6 : 4)) {
                                        while (engine.gameData.enemies.findIndex(x => x.id === source.id) < (highDiff ? 4 : 3)) {
                                            CardScriptParts.SpawnEnemy('reaper_feeder', 'absLeft')(engine, source, target);
                                        }
                                        while (engine.gameData.enemies.length < (highDiff ? 9 : 7)) {
                                            CardScriptParts.SpawnEnemy('reaper_feeder', 'absRight')(engine, source, target);
                                        }
                                    }
                                },
                            ],
                        }
                    ],
                );
            }
        },
    },

    enemyCards: {
        reaper_feeder: (engine: GameEngine.IGameEngine): GameEngine.IEnemyCardState => {
            return {
                id: engine.nextId(),
                enemyClass: 'reaper_feeder',
                cpu: 0,
                mem: 0,
                maxMem: 0,
                sec: randInt(
                    GameEngineUtils.scaleByDifficulty(50, engine.gameData.difficulty),
                    GameEngineUtils.scaleByDifficulty(100, engine.gameData.difficulty),
                ),
                mods: [
                    new RulesetReaper.cardMods.reaper_feederPower().serialize(),
                ],
                scripts: [],
            };
        },

        reaper_guardian: (engine: GameEngine.IGameEngine) => {
            const enemy: GameEngine.IEnemyCardState = {
                id: engine.nextId(),
                enemyClass: 'reaper_guardian',
                cpu: 2,
                mem: 0,
                maxMem: 0,
                sec: 1,
                mods: [
                    new CardMod.Content._standardAi().serialize(),
                    new CardMod.Content.impervious().serialize(),
                ],
                scripts: [],
            };
            enemy.scripts.push(
                new CardScript.Content._attack(enemy, engine.gameData.difficulty).serialize(),
            );
            return enemy;
        },


        reaper_lesser_guardian: (engine: GameEngine.IGameEngine) => {
            const enemy: GameEngine.IEnemyCardState = {
                id: engine.nextId(),
                enemyClass: 'reaper_lesser_guardian',
                cpu: 2,
                mem: 0,
                maxMem: 0,
                sec: 1,
                mods: [
                    new CardMod.Content._standardAi().serialize(),
                    new CardMod.Content.impervious().serialize(),
                ],
                scripts: [],
            };
            enemy.scripts.push(
                new CardScript.Content._attack(enemy, engine.gameData.difficulty, 'weak', 1).serialize(),
            );
            return enemy;
        },
    },

    initGame(engine: GameEngine.IGameEngine) {
        const boss: GameEngine.IEnemyCardState = {
            id: engine.nextId(),
            enemyClass: 'reaper_boss',
            cpu: 0,
            mem: 0,
            maxMem: 0,
            sec: GameEngineUtils.scaleByDifficulty(250, engine.gameData.difficulty),
            mods: [
                new CardMod.Content._standardAi().serialize(),
                new CardMod.Content._winOnDeath().serialize(),
                new CardMod.Content.impervious().serialize(),
            ],
            scripts: [],
        };

        boss.scripts.push(
            new RulesetReaper.cardScripts.reaper_bossEat(boss).serialize(),
        );

        GameEngineUtils.addEnemy(engine, RulesetReaper.enemyCards.reaper_feeder(engine), 0, true);
        engine.gameData.difficulty >= 7 && GameEngineUtils.addEnemy(engine, RulesetReaper.enemyCards.reaper_lesser_guardian(engine), 0, true);
        GameEngineUtils.addEnemy(engine, RulesetReaper.enemyCards.reaper_guardian(engine), 0, true);
        GameEngineUtils.addEnemy(engine, boss, 0, true);
        GameEngineUtils.addEnemy(engine, RulesetReaper.enemyCards.reaper_guardian(engine), 0, true);
        engine.gameData.difficulty >= 7 && GameEngineUtils.addEnemy(engine, RulesetReaper.enemyCards.reaper_lesser_guardian(engine), 0, true);
        GameEngineUtils.addEnemy(engine, RulesetReaper.enemyCards.reaper_feeder(engine), 0, true);
    },
};
