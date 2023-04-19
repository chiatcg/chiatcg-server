import * as moment from 'moment';
import { z } from 'zod';
import { IAuthProvider, IDataSource } from '../dependencies';
import { ExtDeps } from '../external-dependencies';
import { toClientPlayer } from '../models';
import { IHttpRouteHandler, StatusCodes } from '../net-utils';
import { FULL_DATETIME_FORMAT } from '../utils';

export const createPlayerHandler = (ds: IDataSource, authProvider: IAuthProvider): IHttpRouteHandler =>
    async (path, _query, body, req) => {
        switch (path[0]) {
            case 'connectDid': {
                const schema = z.object({
                    didProof: z.object({
                        latestCoinId: z.string(),
                        pubkey: z.string(),
                        signature: z.string(),
                    }),
                });

                const payload = schema.parse(body);

                const did = (await ExtDeps.verifyDidProof(payload.didProof))?.did;
                if (!did) {
                    return [StatusCodes.unauthorized, { reason: 'unable to validate did proof' }];
                }

                let player = await ds.Players.get(did);
                const isNew = !player;
                const now = moment.utc();
                const newSecret = authProvider.generateNewSecret();
                const newAuthExpireAt = moment.utc(now).add({ days: 14 }).format(FULL_DATETIME_FORMAT);
                if (!player) {
                    const nowStr = now.format(FULL_DATETIME_FORMAT);
                    player = await ds.Players.update.exec({
                        id: did,
                        createdAt: nowStr,
                        lastSeenAt: nowStr,
                        secret: newSecret,
                        authExpiresAt: newAuthExpireAt,
                        activeGameId: '',
                        activeDeckId: 'default',
                    });
                } else {
                    player.secret = newSecret;
                    player.authExpiresAt = newAuthExpireAt;
                    await ds.Players.update.exec(player);
                }

                return [StatusCodes.ok, {
                    player: toClientPlayer(player, authProvider),
                    status: isNew ? 'new' : 'existing',
                }];
            }

            case 'me': {
                const player = await authProvider.getPlayerFromRequest(req);
                return [StatusCodes.ok, { player: toClientPlayer(player, authProvider) }];
            }
        }
        return;
    };