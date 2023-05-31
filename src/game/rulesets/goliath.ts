import { CardMod } from '../card-mods';
import { CardScript } from '../card-scripts';
import { GameContent_v1 } from '../game-content-v1';
import { GameEngine } from '../game-engine';
import { GameEngineUtils } from '../game-engine-utils';

const GOLIATH_ID = 9999;

export const RulesetGoliath = {
    cardMods: {
        goliath_power_supply: class extends CardMod {
            override onCardDestroyed(deps: CardMod.ICardModDeps) {
                const goliath = GameEngineUtils.findCardById(deps.engine.gameData, GOLIATH_ID);
                CardMod.addMod(deps.engine, goliath, new RulesetGoliath.cardMods.goliath_boss_power(), deps.sourceCard);
            }
        },

        goliath_shield_supply: class extends CardMod {
            override onCardDestroyed(deps: CardMod.ICardModDeps) {
                const goliath = GameEngineUtils.findCardById(deps.engine.gameData, GOLIATH_ID);
                CardMod.addMod(deps.engine, goliath, new RulesetGoliath.cardMods.goliath_boss_shield(), deps.sourceCard);
            }
        },

        goliath_boss_ai: class extends CardMod {
            override onTurnStart(deps: CardMod.ICardModDeps) {
                GameEngineUtils.generateIntent(deps.engine, deps.sourceCard as GameEngine.IEnemyCardState);
            }

            override onTurnEnd(deps: CardMod.ICardModDeps) {
                const boss = deps.sourceCard as GameEngine.IEnemyCardState;
                const targetId = boss.intent?.targetCardId;
                if (!targetId) return;

                let numAttacks = 1;
                const powerBuff = CardMod.findModOfType(boss, RulesetGoliath.cardMods.goliath_boss_power);
                if (powerBuff) {
                    const powerStacks = CardMod.getStackCount(powerBuff);
                    numAttacks += powerStacks;
                }

                for (let i = 0; i < numAttacks - 1; i++) {
                    GameEngineUtils.executeIntent(deps.engine, boss, true);
                }
                GameEngineUtils.executeIntent(deps.engine, boss);
            }

            override onMemDmgIn(deps: CardMod.ICardModDeps, memDmg: number) {
                if (deps.sourceCard.mem - memDmg <= 0) return;

                const boss = deps.sourceCard as GameEngine.IEnemyCardState;
                let secBonus = 100;
                const shieldBuff = CardMod.findModOfType(boss, RulesetGoliath.cardMods.goliath_boss_shield);
                if (shieldBuff) {
                    secBonus += CardMod.getStackCount(shieldBuff) * 100;
                }
                GameEngineUtils.changeSec(deps.engine, deps.sourceCard, GameEngineUtils.scaleByDifficulty(secBonus, deps.engine.gameData.difficulty), false, deps.sourceCard);

                for (const enemy of [...deps.engine.gameData.enemies]) {
                    if (enemy === boss) continue;

                    CardMod.addMod(deps.engine, enemy, new GameContent_v1.cardMods.optimized(1, -1), boss);
                }
            }
        },

        goliath_boss_power: class extends CardMod {
            override stackingConfig = {
                behavior: CardMod.StackingBehavior.stack as const,
                stackCount: 1,
            };
        },

        goliath_boss_shield: class extends CardMod {
            override stackingConfig = {
                behavior: CardMod.StackingBehavior.stack as const,
                stackCount: 1,
            };
        },
    },

    enemyCards: {
        goliath_power_node: (engine: GameEngine.IGameEngine) => {
            const enemy: GameEngine.IEnemyCardState = {
                id: engine.nextId(),
                enemyClass: '',

                cpu: 2,
                mem: 2,
                maxMem: 2,
                sec: GameEngineUtils.scaleByDifficulty(35, engine.gameData.difficulty),
                mods: [
                    new CardMod.Content._standardAi().serialize(),
                    new RulesetGoliath.cardMods.goliath_power_supply().serialize(),
                ],
                scripts: [],
            };
            enemy.scripts.push(
                new CardScript.Content._attack(enemy, engine.gameData.difficulty, 'weak').serialize(),
            );
            return enemy;
        },

        goliath_shield_node: (engine: GameEngine.IGameEngine) => {
            const enemy: GameEngine.IEnemyCardState = {
                id: engine.nextId(),
                enemyClass: '',

                cpu: 1,
                mem: 2,
                maxMem: 2,
                sec: GameEngineUtils.scaleByDifficulty(45, engine.gameData.difficulty),
                mods: [
                    new CardMod.Content._standardAi().serialize(),
                    new RulesetGoliath.cardMods.goliath_shield_supply().serialize(),
                ],
                scripts: [],
            };
            enemy.scripts.push(
                new CardScript.Content._defend(enemy, engine.gameData.difficulty, 'weak').serialize(),
                new CardScript.Content._firewallSelf(enemy, 1, 2).serialize(),
            );
            return enemy;
        },
    },

    initGame(engine: GameEngine.IGameEngine) {
        const boss: GameEngine.IEnemyCardState = {
            id: GOLIATH_ID,
            enemyClass: 'goliath_boss',
            cpu: 2,
            mem: 4,
            maxMem: 4,
            sec: GameEngineUtils.scaleByDifficulty(100, engine.gameData.difficulty),
            mods: [
                new RulesetGoliath.cardMods.goliath_boss_ai().serialize(),
                new CardMod.Content._winOnDeath().serialize(),
            ],
            scripts: [],
        };

        boss.scripts.push(
            new CardScript.Content._attack(boss, engine.gameData.difficulty).serialize(),
        );

        engine.gameData.difficulty >= 7 && GameEngineUtils.spawnEnemy(engine, RulesetGoliath.enemyCards.goliath_shield_node.name, 0, true);
        GameEngineUtils.spawnEnemy(engine, RulesetGoliath.enemyCards.goliath_power_node.name, 0, true);
        GameEngineUtils.spawnEnemy(engine, RulesetGoliath.enemyCards.goliath_shield_node.name, 0, true);
        GameEngineUtils.addEnemy(engine, boss, 0, true);
        GameEngineUtils.spawnEnemy(engine, RulesetGoliath.enemyCards.goliath_shield_node.name, 0, true);
        GameEngineUtils.spawnEnemy(engine, RulesetGoliath.enemyCards.goliath_power_node.name, 0, true);
        engine.gameData.difficulty >= 7 && GameEngineUtils.spawnEnemy(engine, RulesetGoliath.enemyCards.goliath_shield_node.name, 0, true);
    },
};