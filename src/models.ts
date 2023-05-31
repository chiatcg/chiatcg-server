import { appraiseCard } from './appraise';
import { IAuthProvider, IDataSource } from './dependencies';

export const toClientPlayer = (player: IDataSource.IPlayer, authProvider: IAuthProvider) => {
    return {
        ...player,
        authToken: authProvider.getAuthTokenForPlayer(player),
    };
}

export const toClientDeck = (player: IDataSource.IPlayer, deck: IDataSource.ICardDeck | null) => {
    if (!deck) return null;
    return {
        id: deck.createdAt,
        label: deck.label,
        cards: deck.cards.map(appraiseCard),
        isActiveDeck: player.activeDeckId === deck.createdAt,
    };
};