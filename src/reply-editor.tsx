import { Filter } from "nostr-tools/lib/filter";
import { ZapThreadsContext } from ".";
import { defaultPicture, shortenEncodedId, updateMetadata } from "./util/ui";
import { Show, createSignal, useContext } from "solid-js";
import { UnsignedEvent, Event, nip19, generatePrivateKey, getSignature, getPublicKey, getEventHash } from "nostr-tools";
import { EventSigner, User, eventsStore, usersStore } from "./util/stores";

export const ReplyEditor = (props: { replyTo?: string; onDone?: Function; }) => {
  const { pool, relays, filter } = useContext(ZapThreadsContext)!;

  const [comment, setComment] = createSignal('');

  const loggedInUser = () => {
    return Object.values(usersStore).find(u => u.loggedIn === true);
  };

  const login = async () => {
    const pubkey = await window.nostr!.getPublicKey();
    if (pubkey) {
      usersStore[pubkey] = {
        timestamp: 0,
        loggedIn: true,
        npub: nip19.npubEncode(pubkey),
        signEvent: async (event) => window.nostr!.signEvent(event),
      };

      if (!usersStore[pubkey].name) {
        const result = await pool.list(relays, [{
          kinds: [0],
          authors: [pubkey]
        }]);
        updateMetadata(result);
      }
    } else {
      alert('Access was denied');
    }
  };

  const publish = async (user: User) => {
    if (!user && !usersStore.anonymous) {
      const sk = generatePrivateKey();
      user = usersStore.anonymous = {
        timestamp: 0,
        npub: nip19.npubEncode(getPublicKey(sk)),
        signEvent: async (event) => ({ sig: getSignature(event, sk) }),
      };
    }

    if (!user.signEvent) return;

    const content = comment().trim();
    if (!content) return;

    const unsignedEvent: UnsignedEvent<1> = {
      kind: 1,
      created_at: Math.round(Date.now() / 1000),
      content: content,
      pubkey: nip19.decode(user.npub!).data.toString(),
      tags: []
    };

    // Set root
    unsignedEvent.tags.push(tagFor(filter()!));

    // Set reply
    if (props.replyTo) {
      // If the replyTo does not have a reply it means it is at root level
      // const type = props.replyTo.reply?.id != null ? "reply" : "root";
      // TODO restore when root is the article ("a")
      const reply = ["e", props.replyTo, "", "reply"];
      unsignedEvent.tags.push(reply);
    }

    const id = getEventHash(unsignedEvent);
    const signature = await user.signEvent(unsignedEvent);

    const event: Event<1> = { id, ...unsignedEvent, ...signature };

    // const sub = pool.publish(relays, event);
    // sub.on('ok', function ok() {
    //   sub.off('ok', ok);
    // });
    // sub.on('failed', function failed() {
    //   sub.off('failed', failed);
    // });

    console.log(JSON.stringify(event, null, 2));
    setComment('');
    eventsStore[event.id] = event;

    props.onDone?.call(this);
  };

  return <div class="ctr-reply-form">
    <textarea
      value={comment()}
      placeholder='Add your comment...'
      autofocus={true}
      onChange={e => setComment(e.target.value)}
    />
    <div class="ctr-reply-controls">
      <Show
        when={loggedInUser()}
        fallback={<>
          <button class="ctr-reply-button" onClick={() => publish(usersStore.anonymous)}>Reply anonymously</button>
          {window.nostr && <button class="ctr-reply-login-button" onClick={login}>Log-in</button>}
        </>}
      >
        <div class="ctr-comment-info-picture">
          <img src={loggedInUser()!.imgUrl || defaultPicture} />
        </div>
        <button class="ctr-reply-button" onClick={() => publish(loggedInUser()!)}>Reply as {loggedInUser()!.name || shortenEncodedId(loggedInUser()!.npub!)}</button>
      </Show>
    </div>
  </div>;
};

function tagFor(filter: Filter): string[] {
  if (filter["#e"]) {
    return ["e", filter["#e"][0], "", "root"];
  } else {
    return ["a", filter["#a"][0], "", "root"];
  }
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent: EventSigner;
    };
  }
}