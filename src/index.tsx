import { Accessor, Show, createContext, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createScheduled, debounce } from "@solid-primitives/scheduled";
import { RootComment } from "./root-comment";
import { customElement } from 'solid-element';
import style from './styles/index.css?raw';
import { Event, Filter, SimplePool, Sub } from "nostr-tools";
import { filterToReplaceableId, updateMetadata } from "./util/ui";
import { nest } from "./util/nest";
import { eventsStore, preferencesStore } from "./util/stores";
import { Thread } from "./thread";

const ZapThreads = (props: { anchor: string, relays: string[]; disableLikes?: boolean, disableZaps?: boolean; }) => {
  if (!props.anchor.startsWith('naddr') && !props.anchor.startsWith('http')) {
    throw "Only NIP-19 naddr and URLs are supported";
  }

  // Store preferences
  preferencesStore.disableLikes = props.disableLikes || false;
  preferencesStore.disableZaps = props.disableZaps || false;
  const relays = props.relays.length > 0 ? props.relays : ["wss://relay.damus.io", "wss://eden.nostr.land"];

  const [filter, setFilter] = createSignal<Filter>();

  const pool = new SimplePool();
  let sub: Sub<1>;

  onMount(async () => {
    try {
      if (props.anchor.startsWith('http')) {
        const eventsForUrl = await pool.list(relays, [
          {
            '#r': [props.anchor],
            kinds: [1]
          }
        ]);
        const eventIdsForUrl = eventsForUrl.map((e) => e.id);
        setFilter({ "#e": eventIdsForUrl });
      } else { // naddr
        const id = filterToReplaceableId(props.anchor);
        setFilter({ "#a": [id] });
      }

      sub = pool.sub(relays, [{ ...filter(), kinds: [1] }]);

      sub.on('event', e => {
        if (e.content) {
          eventsStore[e.id] = e;
        }
      });
    } catch (e) {
      // TODO properly handle error
      console.log(e);
    }
  });

  onCleanup(() => {
    sub?.unsub();
  });

  const scheduledDebounce = createScheduled(fn => debounce(fn, 16));
  const debouncedEvents = createMemo((e: Event<1>[] = []) => {
    if (scheduledDebounce() && Object.keys(eventsStore).length > 0) {
      return Object.values(eventsStore);
    }
    return e;
  });
  const nestedEvents = () => nest(debouncedEvents());

  const profilesDebounce = createScheduled(fn => debounce(fn, 1200));

  // Get all author pubkeys from known events when event loading has somewhat settled
  createEffect(async () => {
    if (profilesDebounce() && Object.keys(eventsStore).length > 0) {
      const authorPubkeys = Object.values(eventsStore).map(e => e.pubkey);
      const result = await pool.list(relays, [{
        kinds: [0],
        authors: [...new Set(authorPubkeys)] // Set makes pubkeys unique
      }]);
      updateMetadata(result);
    }
  });

  return <div id="ctr-root">
    <style>{style}</style>
    <ZapThreadsContext.Provider value={{ pool, relays, filter }}>
      <RootComment />
      <h2 id="ctr-title">{Object.keys(eventsStore).length} comments</h2>
      <Show when={!preferencesStore.disableZaps}>
        <h3 id="ctr-subtitle">2397 sats</h3>
      </Show>
      <Thread nestedEvents={nestedEvents} />
    </ZapThreadsContext.Provider>
  </div>;
};

export default ZapThreads;

export const ZapThreadsContext = createContext<{
  pool: SimplePool,
  relays: string[],
  filter: Accessor<Filter | undefined>;
}>();

customElement('zap-threads', { relays: "", anchor: "", 'disable-likes': "", 'disable-zaps': "" }, (props) => {
  const relays = props.relays === "" ? [] : props.relays.split(",");

  return <ZapThreads
    anchor={props.anchor}
    relays={relays}
    disableLikes={props['disable-likes'] === "true"}
    disableZaps={props['disable-zaps'] === "true"}
  />;
});