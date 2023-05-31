import { CardMod } from '../card-mods';
import { CardScriptParts } from '../card-script-parts';
import { CardScript } from '../card-scripts';
import { GameEngine } from '../game-engine';
import { GameEngineUtils } from '../game-engine-utils';

export const RulesetStasis = {
    cardMods: {
        stasis_boss_ai: class extends CardMod.Content._standardAi {
            override onMemDmgIn(deps: CardMod.ICardModDeps, memDmg: number) {
                if (deps.sourceCard.mem - memDmg <= 0) return;

                for (const playerCard of GameEngineUtils.getPlayerCards(deps.engine.gameData)) {
                    CardMod.addMod(deps.engine, playerCard, new CardMod.Content.lag(1), deps.sourceCard);
                }

                GameEngineUtils.changeSec(deps.engine, deps.sourceCard, GameEngineUtils.scaleByDifficulty(125, deps.engine.gameData.difficulty), false, deps.contextCard);

                if (![...deps.engine.gameData.enemies].find(x => x.enemyClass === RulesetStasis.enemyCards.stasis_disruptor.name)) {
                    GameEngineUtils.spawnEnemy(deps.engine, RulesetStasis.enemyCards.stasis_disruptor.name, 0, true);
                }
            }
        },
    },

    enemyCards: {
        stasis_disruptor: (engine: GameEngine.IGameEngine) => {
            const enemy: GameEngine.IEnemyCardState = {
                id: engine.nextId(),
                enemyClass: '',

                cpu: 1,
                mem: 3,
                maxMem: 3,
                sec: GameEngineUtils.scaleByDifficulty(35, engine.gameData.difficulty),
                mods: [
                    new CardMod.Content._standardAi().serialize(),
                ],
                scripts: [],
            };
            enemy.scripts.push(
                new CardScript.Content._attack(enemy, engine.gameData.difficulty).serialize(),
                new RulesetStasis.cardScripts.stasis_disrupt(enemy, engine.gameData.difficulty).serialize(),
            );
            return enemy;
        },

        stasis_shocker: (engine: GameEngine.IGameEngine) => {
            const enemy: GameEngine.IEnemyCardState = {
                id: engine.nextId(),
                enemyClass: '',

                cpu: 1,
                mem: 2,
                maxMem: 2,
                sec: GameEngineUtils.scaleByDifficulty(45, engine.gameData.difficulty),
                mods: [
                    new CardMod.Content._standardAi().serialize(),
                ],
                scripts: [],
            };
            enemy.scripts.push(
                new CardScript.Content._attack(enemy, engine.gameData.difficulty).serialize(),
            );
            return enemy;
        },
    },

    cardScripts: {
        stasis_disrupt: class extends CardScript {
            constructor(card: GameEngine.ICardState, difficulty: number) {
                const dmg = GameEngineUtils.scaleByDifficulty(GameEngineUtils.scaleByCpuMem(5, card.cpu), difficulty);

                super(
                    [difficulty, dmg],
                    CardScript.TargetFinders.Opponents(),
                    [
                        {
                            targetResolver: CardScript.TargetResolvers.Target,
                            parts: [
                                CardScriptParts.Attack(dmg),
                                CardScriptParts.AddMod(new CardMod.Content.lag(2)),
                            ],
                        }
                    ],
                );
            }
        }
    },

    initGame(engine: GameEngine.IGameEngine) {
        const boss: GameEngine.IEnemyCardState = {
            id: engine.nextId(),
            enemyClass: 'stasis_boss',
            cpu: 3,
            mem: 3,
            maxMem: 3,
            sec: GameEngineUtils.scaleByDifficulty(125, engine.gameData.difficulty),
            mods: [
                new RulesetStasis.cardMods.stasis_boss_ai().serialize(),
                new CardMod.Content._winOnDeath().serialize(),
            ],
            scripts: [],
        };

        boss.scripts.push(
            new CardScript.Content._attack(boss, engine.gameData.difficulty, 'strong').serialize(),
            new RulesetStasis.cardScripts.stasis_disrupt(boss, engine.gameData.difficulty).serialize(),
        );

        engine.gameData.difficulty >= 7 && GameEngineUtils.spawnEnemy(engine, RulesetStasis.enemyCards.stasis_disruptor.name, 0, true);
        GameEngineUtils.spawnEnemy(engine, RulesetStasis.enemyCards.stasis_shocker.name, 0, true);
        GameEngineUtils.spawnEnemy(engine, RulesetStasis.enemyCards.stasis_disruptor.name, 0, true);
        GameEngineUtils.addEnemy(engine, boss, 0, true);
        GameEngineUtils.spawnEnemy(engine, RulesetStasis.enemyCards.stasis_disruptor.name, 0, true);
        GameEngineUtils.spawnEnemy(engine, RulesetStasis.enemyCards.stasis_shocker.name, 0, true);
        engine.gameData.difficulty >= 7 && GameEngineUtils.spawnEnemy(engine, RulesetStasis.enemyCards.stasis_disruptor.name, 0, true);
    },
};