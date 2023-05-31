import { CardMod } from '../card-mods';
import { CardScript } from '../card-scripts';
import { GameEngine } from '../game-engine';
import { GameEngineUtils } from '../game-engine-utils';

export const RulesetMfrm = {
    enemyCards: {
        intro_sentinel: (engine: GameEngine.IGameEngine) => {
            const enemy: GameEngine.IEnemyCardState = {
                id: engine.nextId(),
                enemyClass: 'intro_sentinel',
                cpu: 2,
                mem: 2,
                maxMem: 2,
                sec: GameEngineUtils.scaleByDifficulty(50, engine.gameData.difficulty),
                mods: [new CardMod.Content._standardAi().serialize()],
                scripts: [],
            };
            enemy.scripts.push(
                new CardScript.Content._attack(enemy, engine.gameData.difficulty).serialize(),
                new CardScript.Content._defend(enemy, engine.gameData.difficulty).serialize(),
                new CardScript.Content._firewallSelf(enemy, 1, 2).serialize(),
            );
            return enemy;
        },

        intro_perimeter: (engine: GameEngine.IGameEngine) => {
            const enemy: GameEngine.IEnemyCardState = {
                id: engine.nextId(),
                enemyClass: 'intro_perimeter',
                cpu: 1,
                mem: 1,
                maxMem: 1,
                sec: GameEngineUtils.scaleByDifficulty(30, engine.gameData.difficulty),
                mods: [new CardMod.Content._standardAi().serialize()],
                scripts: [],
            };
            enemy.scripts.push(
                new CardScript.Content._attack(enemy, engine.gameData.difficulty, 'weak').serialize(),
            );
            return enemy;
        },
    },

    initGame(engine: GameEngine.IGameEngine) {
        const boss: GameEngine.IEnemyCardState = {
            id: engine.nextId(),
            enemyClass: 'intro_boss',
            cpu: 3,
            mem: 3,
            maxMem: 3,
            sec: GameEngineUtils.scaleByDifficulty(125, engine.gameData.difficulty),
            mods: [],
            scripts: [],
        };
        boss.mods.push(
            new CardMod.Content._standardAi().serialize(),
            new CardMod.Content._waveTrigger(['reaper', 'goliath', 'stasis', 'stasis'], 12).serialize(),
            new CardMod.Content._yieldScript(new CardScript.Content._spawn(boss, RulesetMfrm.enemyCards.intro_perimeter.name, undefined, undefined, 2).serialize(), 2).serialize(),
        );
        boss.scripts.push(
            new CardScript.Content._defend(boss, engine.gameData.difficulty).serialize(),
        );

        GameEngineUtils.addEnemy(engine, boss, 0, true);
        GameEngineUtils.addEnemy(engine, RulesetMfrm.enemyCards.intro_sentinel(engine), 0, true);
        GameEngineUtils.addEnemy(engine, RulesetMfrm.enemyCards.intro_perimeter(engine), 0, true);
        engine.gameData.difficulty >= 7 && GameEngineUtils.addEnemy(engine, RulesetMfrm.enemyCards.intro_perimeter(engine), 0, true);
        GameEngineUtils.addEnemy(engine, RulesetMfrm.enemyCards.intro_sentinel(engine), engine.gameData.enemies.length, true);
        GameEngineUtils.addEnemy(engine, RulesetMfrm.enemyCards.intro_perimeter(engine), engine.gameData.enemies.length, true);
        engine.gameData.difficulty >= 7 && GameEngineUtils.addEnemy(engine, RulesetMfrm.enemyCards.intro_perimeter(engine), engine.gameData.enemies.length, true);
    }
};