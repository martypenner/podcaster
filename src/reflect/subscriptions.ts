// This file defines our "subscriptions". Subscriptions are how Reflect
// notifies you when data has changed. Subscriptions fire whenever the watched
// data changes, whether because the local client changed it, or because some
// other collaborating client changed it. The model is that you render your app
// reactively based on these subscriptions. This guarantees the UI always
// consistently shows the latest data.
//
// Subscriptions can be arbitrary computations of the data in Reflect. The
// subscription "query" is re-run whenever any of the data it depends on
// changes. The subscription "fires" when the result of the query changes.

import type { Episode, Feed, StoredEpisode } from '@/data';
import {
  episodesByPodcastId,
  podcastById,
  trending,
} from '@/services/podcast-api';
import type { Reflect } from '@rocicorp/reflect/client';
import { useSubscribe } from '@rocicorp/reflect/react';
import { useEffect } from 'react';
import type { Mutators } from './mutators';

export function useInitialized(reflect: Reflect<Mutators>): boolean {
  const initialized = useSubscribe(
    reflect,
    async (tx) => {
      const initialized = await tx.get<true>('/init');
      if (!initialized) {
        await reflect.mutate.initialize();
      }
      return true;
    },
    false,
  );
  return initialized;
}

export function useFeeds(reflect: Reflect<Mutators>): Feed[] {
  const initialized = useInitialized(reflect);
  const feeds = useSubscribe(
    reflect,
    async (tx) => {
      return (await tx
        .scan({
          prefix: 'feed/',
        })
        .toArray()) as Feed[];
    },
    null,
  );

  useEffect(() => {
    const doIt = async () => {
      const feeds = await trending();
      await reflect.mutate.addFeeds(
        feeds.map((feed) =>
          typeof feed === 'string' ? JSON.parse(feed) : feed,
        ),
      );
    };

    if (initialized && feeds == null) {
      doIt();
    }
  }, [feeds, initialized, reflect.mutate]);

  return feeds ?? [];
}

export function useFeedById(
  reflect: Reflect<Mutators>,
  key: Feed['id'],
): Feed | null {
  return useSubscribe(
    reflect,
    async (tx) => {
      return (await tx.get(`feed/${key}`)) as Feed | null;
    },
    null,
  );
}

export function useEpisodesForFeed(
  reflect: Reflect<Mutators>,
  feedId: Feed['id'] | null,
): Episode[] {
  const initialized = useInitialized(reflect);
  const episodes = useSubscribe(
    reflect,
    async (tx) => {
      const list = (
        (await tx
          .scan({ prefix: `episode/${feedId}/` })
          .toArray()) as StoredEpisode[]
      ).map((episode) => ({
        ...episode,
        datePublished: new Date(episode.datePublished),
        explicit: !!episode.explicit,
      }));
      return list as Episode[];
    },
    null,
  );

  // Fetch new episodes that aren't in the cache yet.
  useEffect(() => {
    const doIt = async () => {
      try {
        const [podcast, episodes] = await Promise.all([
          podcastById(feedId),
          episodesByPodcastId(feedId),
        ]);
        await Promise.all([
          reflect.mutate.addFeed(podcast),
          reflect.mutate.addEpisodesForFeed(episodes),
        ]);
      } catch (error) {
        console.error(error);
      }
    };

    if (initialized && episodes == null) {
      doIt();
    }
  }, [episodes, feedId, initialized, reflect.mutate]);

  return episodes ?? [];
}
