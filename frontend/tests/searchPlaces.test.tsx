import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { useTripStore } from '../src/stores/tripStore';
import { SearchResults } from '../src/components/Chat/widgets/SearchResults';

const PLACES = [
  {
    placeId: 'p1',
    name: 'Brandenburg Gate',
    place_id: 'p1',
    imageUrl: '',
    rating: 4.7,
    type: 'tourist_attraction',
    address: 'Pariser Platz, Berlin',
    coordinates: { lat: 52.5163, lng: 13.3777 },
  },
  {
    placeId: 'p2',
    name: 'Berlin TV Tower',
    place_id: 'p2',
    imageUrl: 'https://img.example/tv.jpg',
    rating: 4.4,
    type: 'point_of_interest',
    address: 'Panoramastraße, Berlin',
    coordinates: { lat: 52.5208, lng: 13.4094 },
  },
];

describe('tripStore searchPlaces lifecycle', () => {
  beforeEach(() => {
    useTripStore.setState({ searchPlaces: null, searchPlacesConvId: null, tripState: null });
  });

  it('stores places with the owning conversation', () => {
    useTripStore.getState().setSearchPlaces(PLACES, 'conv-1');
    expect(useTripStore.getState().searchPlaces).toHaveLength(2);
    expect(useTripStore.getState().searchPlacesConvId).toBe('conv-1');
  });

  it('normalizes empty results to null', () => {
    useTripStore.getState().setSearchPlaces([], 'conv-1');
    expect(useTripStore.getState().searchPlaces).toBeNull();
    expect(useTripStore.getState().searchPlacesConvId).toBeNull();
  });

  it('keeps pins when an itinerary arrives — explored and planned coexist', () => {
    useTripStore.getState().setSearchPlaces(PLACES, 'conv-1');
    useTripStore.getState().setTripState({ itinerary: { days: [] }, cities: [] } as any);
    expect(useTripStore.getState().searchPlaces).toHaveLength(2);
  });

  it('keeps pins when a non-itinerary tripState arrives', () => {
    useTripStore.getState().setSearchPlaces(PLACES, 'conv-1');
    useTripStore.getState().setTripState({ cities: [{ name: 'Berlin' }] } as any);
    expect(useTripStore.getState().searchPlaces).toHaveLength(2);
  });
});

describe('SearchResults postcards', () => {
  it('reports card hover for map pin highlighting', () => {
    const onHover = vi.fn();
    render(
      <SearchResults data={{ places: PLACES }} text="Here are sights" onHoverPlace={onHover} />
    );
    const cards = screen.getAllByRole('button');
    cards[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(onHover).toHaveBeenCalledWith('p1');
    cards[0].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('shows a letter placeholder when a place has no photo', () => {
    render(<SearchResults data={{ places: PLACES }} text="" />);
    // p1 has no imageUrl → placeholder shows the initial
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});
