import { randInt } from '../utils';
import { CardMod } from './card-mods';
import { CardScriptParts } from './card-script-parts';
import { CardScript } from './card-scripts';
import { GameEngine } from './game-engine';
import { GameEngineUtils } from './game-engine-utils';

const _cardMods = {
    // Increases incoming damage
    exposed: class extends CardMod {
        override stackingConfig = {
            behavior: CardMod.StackingBehavior.stack as const,
            stackCount: 0,
        };

        constructor(public stackCount: number) {
            super(arguments);
            this.stackingConfig.stackCount = stackCount;
        }

        override onSecDamageIn(_deps: CardMod.ICardModDeps, _damage: number, _attacker: GameEngine.ICardState) {
            return { secDmgBonus: this.stackingConfig.stackCount };
        }
    },

    // Returns damage to attacker
    feedback: class extends CardMod {
        override stackingConfig = {
            behavior: CardMod.StackingBehavior.stack as const,
            stackCount: 0,
        };

        constructor(public damage: number) {
            super(arguments);
            this.stackingConfig.stackCount = damage;
        }

        override onSecDamageIn(deps: CardMod.ICardModDeps, _damage: number, attacker: GameEngine.ICardState) {
            CardScriptParts.SecDmg(this.stackingConfig.stackCount, false, true)(deps.engine, deps.sourceCard, attacker);
        }
    },

    // Increases CPU
    optimized: class extends CardMod {
        override stackingConfig = {
            behavior: CardMod.StackingBehavior.stack as const,
            stackCount: 0,
        };

        constructor(cpuBonus: number, override duration: number) {
            super(arguments);
            this.stackingConfig.stackCount = cpuBonus;
        }

        override onInitMod(deps: CardMod.ICardModDeps) {
            GameEngineUtils.changeCpu(deps.engine, deps.sourceCard, this.stackingConfig.stackCount);
        }

        override onStackMod(deps: CardMod.ICardModDeps, stackDelta: number) {
            deps.sourceCard.cpu += stackDelta;
            deps.engine.broadcast.push({
                type: 'cpuChanged',
                cardId: deps.sourceCard.id,
                newCpu: deps.sourceCard.cpu,
            });

            GameEngineUtils.recalculateScripts(deps.engine, deps.sourceCard);
        }

        override onRemoveMod(deps: CardMod.ICardModDeps) {
            deps.sourceCard.cpu -= this.stackingConfig.stackCount;
            deps.engine.broadcast.push({
                type: 'cpuChanged',
                cardId: deps.sourceCard.id,
                newCpu: deps.sourceCard.cpu,
            });

            GameEngineUtils.recalculateScripts(deps.engine, deps.sourceCard);
        }
    },

    // Damages on turn end
    virus: class extends CardMod {
        override stackingConfig = {
            behavior: CardMod.StackingBehavior.stack as const,
            stackCount: 0,
        };

        constructor(public dot: number) {
            super(arguments);
            this.stackingConfig.stackCount = dot;
        }

        override onTurnEnd(deps: CardMod.ICardModDeps) {
            CardScriptParts.SecDmg(this.stackingConfig.stackCount, true, true)(deps.engine, deps.sourceCard, deps.sourceCard);
        }
    },
};

const _cardScripts = {
    //
    // Backdoor scripts
    //

    // Swap MEM for CPU
    bd_caching: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                (gameData, card) => CardScript.TargetFinders.Allies()(gameData, card).filter(x => x.mem > 1),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.RaiseMem(-1),
                            CardScriptParts.ChangeCpu(1),
                        ],
                    }
                ],
            );
            this.cooldownMax = 1;
        }
    },

    // Raise MEM
    bd_defrag: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            const memBonus = 1;

            super(
                [memBonus],
                CardScript.TargetFinders.Any(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.RaiseMem(1),
                        ],
                    }
                ],
            );
            this.cooldownMax = 4;
        }
    },

    // Heal over time
    bd_diagnostics: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const secBonus = GameEngineUtils.scaleByCpuMem(6, card.cpu);
            const duration = 1 + Math.round(card.mem / 2);

            super(
                [secBonus, duration],
                CardScript.TargetFinders.Any(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new CardMod.Content.diagnostics(secBonus, duration)
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = 4;
        }
    },

    // Attack and stun (Backdoor finisher)
    bd_disrupt: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = GameEngineUtils.scaleByCpuMem(9, card.cpu);
            const stunDuration = 1;

            super(
                [damage, stunDuration],
                CardScript.TargetFinders._ModFilter<typeof CardMod.Content, 'backdoor'>(['backdoor'],
                    CardScript.TargetFinders.Opponents(true),
                ),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.Attack(damage),
                            CardScriptParts.AddMod(
                                new CardMod.Content.lag(stunDuration),
                            ),
                            CardScriptParts.RemoveMod<typeof CardMod.Content, 'backdoor'>('backdoor', true),
                        ],
                    }
                ],
            );
            this.cooldownMax = 2;
        }
    },

    // Attack and raise CPU on kill
    bd_extraction: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                (gameData, card) =>
                    CardScript.TargetFinders.Opponents(true)(gameData, card)
                        .filter(target => !target.sec && target.mem === 1),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.Attack(1, true, true),
                        ],
                    },
                    {
                        targetResolver: CardScript.TargetResolvers.Self,
                        parts: [
                            CardScriptParts.ChangeCpu(1),
                        ],
                    },
                ],
            );
        }
    },

    // Raises CPU
    bd_optimize: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const cpuBonus = 1;
            const duration = Math.round(card.cpu / 2);

            super(
                [cpuBonus, duration],
                CardScript.TargetFinders.Allies(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new _cardMods.optimized(cpuBonus, duration),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = 4;
        }
    },

    // Raises SEC
    bd_patch: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const secBonus = GameEngineUtils.scaleByCpuMem(11, card.cpu);

            super(
                [secBonus],
                CardScript.TargetFinders.Any(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.RaiseSec(secBonus),
                        ],
                    }
                ],
            );
            this.cooldownMax = 2;
        }
    },

    // Steal SEC and remove Firewall (Backdoor finisher)
    bd_proxy: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const secDelta = GameEngineUtils.scaleByCpuMem(5, card.cpu);

            super(
                [secDelta],
                CardScript.TargetFinders._ModFilter<typeof CardMod.Content, 'backdoor'>(['backdoor'],
                    CardScript.TargetFinders.Opponents(true),
                ),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.SecDmg(secDelta),
                            CardScriptParts.RemoveMod<typeof CardMod.Content, 'firewall'>('firewall'),
                            CardScriptParts.RemoveMod<typeof CardMod.Content, 'backdoor'>('backdoor', true),
                        ],
                    },
                    {
                        targetResolver: CardScript.TargetResolvers.Self,
                        parts: [
                            CardScriptParts.RaiseSec(secDelta),
                        ],
                    },
                ],
            );
        }
    },

    // Steal SEC and causes offline (Backdoor finisher)
    bd_reboot: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            const secDelta = GameEngineUtils.scaleByCpuMem(5, _card.cpu);
            const offlineDuration = 1;

            super(
                [secDelta, offlineDuration],
                CardScript.TargetFinders._ModFilter<typeof CardMod.Content, 'backdoor'>(['backdoor'],
                    CardScript.TargetFinders.Opponents(true),
                ),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.SecDmg(secDelta),
                            CardScriptParts.AddMod(
                                new CardMod.Content.offline(offlineDuration),
                            ),
                            CardScriptParts.RemoveMod<typeof CardMod.Content, 'backdoor'>('backdoor', true),
                        ],
                    },
                    {
                        targetResolver: CardScript.TargetResolvers.Self,
                        parts: [
                            CardScriptParts.RaiseSec(secDelta),
                        ],
                    },
                ],
            );
            this.cooldownMax = 2;
        }
    },

    // Cause Exposed (Backdoor finisher)
    bd_trace: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const stacks = GameEngineUtils.scaleByCpuMem(7, card.cpu);

            super(
                [stacks],
                CardScript.TargetFinders._ModFilter<typeof CardMod.Content, 'backdoor'>(['backdoor'],
                    CardScript.TargetFinders.Opponents(true),
                ),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new _cardMods.exposed(stacks),
                            ),
                            CardScriptParts.RemoveMod<typeof CardMod.Content, 'backdoor'>('backdoor', true),
                        ],
                    }
                ],
            );
            this.cooldownMax = 2;
        }
    },

    // Attack and remove 1 MEM
    bd_tunnel: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            const memDmg = 1;

            super(
                [memDmg],
                CardScript.TargetFinders._ModFilter<typeof CardMod.Content, 'backdoor'>(['backdoor'],
                    CardScript.TargetFinders.Opponents(true),
                ),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.MemDmg(memDmg),
                            CardScriptParts.RemoveMod<typeof CardMod.Content, 'backdoor'>('backdoor', true),
                        ],
                    }
                ],
            );
            this.cooldownMax = 3;
        }
    },

    //
    // Bruteforce scripts
    //

    // Swap CPU for MEM
    bf_compression: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                (gameData, card) =>
                    CardScript.TargetFinders.Allies()(gameData, card).filter(x => x.cpu > 1),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.ChangeCpu(-1),
                            CardScriptParts.RaiseMem(1),
                        ],
                    }
                ],
            );
            this.cooldownMax = 1;
        }
    },

    // Cause Offline
    bf_ddos: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            const offlineDuration = 1;

            super(
                [offlineDuration],
                CardScript.TargetFinders.Any(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new CardMod.Content.offline(offlineDuration),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = 3;
        }
    },

    // Cause Lag
    bf_dos: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            const lagDuration = 1;

            super(
                [lagDuration],
                CardScript.TargetFinders.Any(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new CardMod.Content.lag(lagDuration),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = 4;
        }
    },

    // Gain feedback
    bf_feedback: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = GameEngineUtils.scaleByCpuMem(10, card.cpu);
            const cooldown = Math.max(0, 4 - Math.round(card.mem / 2));

            super(
                [damage, cooldown],
                CardScript.TargetFinders.Self,
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Self,
                        parts: [
                            CardScriptParts.AddMod(
                                new GameContent_v1.cardMods.feedback(damage),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = cooldown;
        }
    },

    // Triple SEC attack
    bf_flood: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = GameEngineUtils.scaleByCpuMem(3, card.cpu);
            const numAttacks = 3;

            super(
                [damage, numAttacks],
                CardScript.TargetFinders.Opponents(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            ...Array.from(Array(numAttacks)).map(() => CardScriptParts.SecDmg(damage)),
                        ],
                    }
                ],
            );
            this.cooldownMax = 2;
        }
    },

    // AOE attack
    bf_multicast: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = GameEngineUtils.scaleByCpuMem(4, card.cpu);

            super(
                [damage],
                CardScript.TargetFinders.Opponents(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.TargetAndAdjacents,
                        parts: [
                            CardScriptParts.Attack(damage),
                        ],
                    }
                ],
            );
            this.cooldownMax = 1;
        }
    },

    // Raise SEC
    bf_obfuscate: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const secBonus = GameEngineUtils.scaleByCpuMem(10, card.cpu);

            super(
                [secBonus],
                CardScript.TargetFinders.Any(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.RaiseSec(secBonus),
                        ],
                    }
                ],
            );
            this.cooldownMax = 3;
        }
    },

    // Strong attack
    bf_pod: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = GameEngineUtils.scaleByCpuMem(16, card.cpu);

            super(
                [damage],
                CardScript.TargetFinders.Opponents(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.Attack(damage),
                        ],
                    }
                ],
            );
            this.cooldownMax = 2;
        }
    },

    // Raises CPU
    bf_precompute: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const cpuBonus = 1;
            const duration = Math.round(card.cpu / 2);

            super(
                [cpuBonus, duration],
                CardScript.TargetFinders.Allies(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new _cardMods.optimized(cpuBonus, duration),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = 4;
        }
    },


    //
    // Malware scripts
    //

    // Causes Lag
    mw_bloatware: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [1],
                CardScript.TargetFinders.Opponents(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new CardMod.Content.lag(1),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = 3;
        }
    },

    // Swap for another card's secondary script
    mw_copypaste: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                CardScript.TargetFinders.Allies(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            (engine, sourceCard, targetCard) => {
                                CardScript.removeScript(engine, sourceCard, _cardScripts.mw_copypaste);

                                if (!targetCard.scripts[1]) return;

                                CardScript.addScript(engine, sourceCard, CardScript.fromScriptName(engine, sourceCard, targetCard.scripts[1][0]));
                            },
                        ],
                    }
                ],
            );
        }
    },

    // Grant Feedback
    mw_honeypot: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const damage = GameEngineUtils.scaleByCpuMem(6, card.cpu);
            const cooldown = Math.max(0, 4 - Math.round(card.mem / 2));

            super(
                [damage, cooldown],
                CardScript.TargetFinders.Allies(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new GameContent_v1.cardMods.feedback(damage),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = cooldown;
        }
    },

    // Steal SEC
    mw_leech: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const secDelta = GameEngineUtils.scaleByCpuMem(6, card.cpu);

            super(
                [secDelta],
                CardScript.TargetFinders.Opponents(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.SecDmg(secDelta),
                        ],
                    },
                    {
                        targetResolver: CardScript.TargetResolvers.Self,
                        parts: [
                            CardScriptParts.RaiseSec(secDelta),
                        ],
                    },
                ],
            );
            this.cooldownMax = 1;
        }
    },

    // Attack random target
    mw_phishing: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const minDamage = GameEngineUtils.scaleByCpuMem(9, card.cpu);
            const maxDamage = GameEngineUtils.scaleByCpuMem(18, card.cpu);

            super(
                [minDamage, maxDamage],
                CardScript.TargetFinders.Self,
                [
                    {
                        targetResolver: CardScript.TargetResolvers.RandomOpponent,
                        parts: [
                            CardScriptParts.Attack(randInt(minDamage, maxDamage)),
                        ],
                    }
                ],
            );
            this.cooldownMax = 1;
        }
    },

    // Redistribute CPU/MEM
    mw_reimage: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                CardScript.TargetFinders.Allies(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            (engine, _sourceCard, targetCard) => {
                                const totalStats = targetCard.cpu + targetCard.mem;
                                const newCpu = randInt(1, totalStats - 1);
                                const cpuDelta = newCpu - targetCard.cpu;
                                GameEngineUtils.changeCpu(engine, targetCard, cpuDelta);

                                const newMem = totalStats - newCpu;
                                const memDelta = newMem - targetCard.mem;
                                GameEngineUtils.changeMem(engine, targetCard, memDelta);
                            },
                        ],
                    }
                ],
            );
            this.cooldownMax = 1;
        }
    },

    // Raise SEC on random ally
    mw_shareware: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const minBonus = GameEngineUtils.scaleByCpuMem(10, card.cpu);
            const maxBonus = GameEngineUtils.scaleByCpuMem(20, card.cpu);

            super(
                [minBonus, maxBonus],
                CardScript.TargetFinders.Self,
                [
                    {
                        targetResolver: CardScript.TargetResolvers.RandomAlly,
                        parts: [
                            CardScriptParts.RaiseSec(randInt(minBonus, maxBonus)),
                        ],
                    }
                ],
            );
            this.cooldownMax = 3;
        }
    },

    // Redirect intent
    mw_spoof: class extends CardScript {
        constructor(_card: GameEngine.ICardState) {
            super(
                [],
                CardScript.TargetFinders.Opponents(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.RedirectIntentRandom,
                        ],
                    }
                ],
            );
        }
    },

    // Cause Exposed
    mw_spyware: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const stacks = GameEngineUtils.scaleByCpuMem(4, card.cpu);

            super(
                [stacks],
                CardScript.TargetFinders.Opponents(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new _cardMods.exposed(stacks),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = 1;
        }
    },

    // Cause Virus
    mw_virus: class extends CardScript {
        constructor(card: GameEngine.ICardState) {
            const dot = GameEngineUtils.scaleByCpuMem(4, card.cpu);
            super(
                [dot],
                CardScript.TargetFinders.Opponents(),
                [
                    {
                        targetResolver: CardScript.TargetResolvers.Target,
                        parts: [
                            CardScriptParts.AddMod(
                                new _cardMods.virus(dot),
                            ),
                        ],
                    }
                ],
            );
            this.cooldownMax = 2;
        }
    },
};

export const GameContent_v1 = {
    cardMods: _cardMods,
    cardScripts: _cardScripts,
    enemyCards: {},

    initGame(_engine: GameEngine.IGameEngine) {
        throw new Error('not a startable scenario');
    },

    addAdditionalScriptsFor(engine: GameEngine.IGameEngine, card: GameEngine.IPlayerCardState) {
        if (card.card.tier < 2) return;

        switch (card.card.faction) {
            case 'backdoor':
                card.scripts.push(CardScript.deserialize(engine, card, [Object.keys(_cardScripts).filter(x => x.startsWith('bd_')).random()]).serialize());
                return;

            case 'bruteforce':
                card.scripts.push(CardScript.deserialize(engine, card, [Object.keys(_cardScripts).filter(x => x.startsWith('bf_')).random()]).serialize());
                return;

            case 'malware':
                card.scripts.push(CardScript.deserialize(engine, card, [Object.keys(_cardScripts).filter(x => x.startsWith('mw_')).random()]).serialize());
                return;
        }
    },
};
(GameContent_v1 as GameEngine.IRuleset);