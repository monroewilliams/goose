# Goose Chat Display Performance Analysis & Optimization Plan

**Date:** 2026-05-06  
**Status:** Analysis complete, implementation pending

---

## Rendering Pipeline Overview

```
BaseChat (useChatStream)
  └── ScrollArea
        └── ProgressiveMessageList (batches 0..N)
              └── GooseMessage / UserMessage (per message)
                    ├── MarkdownContent (ReactMarkdown)
                    ├── ToolCallWithResponse
                    ├── ThinkingContent
                    └── ToolCallConfirmation / ElicitationRequest
```

---

## Bottleneck #1: ProgressiveMessageList Renders Top-Down (User's Hunch Correct)

**File:** `ui/desktop/src/components/ProgressiveMessageList.tsx`

The component renders messages from index 0 to `renderedCount`:

```tsx
const messagesToRender = messages.slice(0, renderedCount);
return messagesToRender.map((message, index) => { ... });
```

When opening a long saved chat (e.g., 200 messages), the user is always at the bottom, but React must:
1. Build DOM for **all 200 messages** (progressively in batches of 20)
2. Scroll to bottom after rendering completes
3. Each batch re-renders **all previously rendered messages** too (because `renderMessages()` uses `.slice(0, renderedCount).map(...)`)

**Impact:** Linear in total message count for initial load. With 200 messages and batchDelay=20ms, the user waits ~2 seconds seeing a blank or partial list.

---

## Bottleneck #2: Full Message Scan on Every Render

Multiple components scan the **entire** message array on every render:

| Location | Cost |
|---|---|
| `ProgressiveMessageList` — `useMemo(() => identifyConsecutiveToolCalls(messages), [messages])` | O(n) per render, scans all messages |
| `GooseMessage` — `messageIndex = messages.findIndex(...)` | O(n) **per message** — total O(n²) |
| `GooseMessage` — `findConfirmationForToolAcrossMessages` for each tool request | O(n) per tool request, total O(n×tool_requests) |
| `GooseMessage` — `toolResponsesMap` builds a map scanning all messages after current | O(n) per message |
| `BaseChat` — `commandHistory` useMemo reduces over ALL messages | O(n) per render |

For a 200-message chat with ~50 assistant tool-call messages, that's potentially **40,000+ operations per render**, and it runs on **every** streaming update (every SSE `Message` event).

---

## Bottleneck #3: No Message-Level Memoization

`ProgressiveMessageList` calls `.map()` on all messages 0..N on every render. Each resulting `GooseMessage` and `UserMessage` component re-renders even though their props haven't changed — React has no `memo` boundary between them.

When streaming updates arrive (a thinking token is appended to message #150):
1. `useChatStream` dispatches `SET_MESSAGES` with a new array
2. `BaseChat` re-renders (triggered by the `messages` change)
3. `ProgressiveMessageList` re-renders (prop changed)
4. **All messages from 0 to renderedCount get re-rendered**, even though only message #150 changed

**Impact:** For a chat with 150 visible messages, every streaming tick causes 150 components to re-render.

---

## Bottleneck #4: MarkdownContent ReactMarkdown Re-Parsing

**File:** `ui/desktop/src/components/MarkdownContent.tsx`

`MarkdownContent` wraps `ReactMarkdown` in `memo`, but:
- The `processedContent` state triggers re-render via `useEffect` on `content` change
- `ReactMarkdown` re-parses the entire markdown AST on every render — this is computationally expensive
- For streaming messages that grow character-by-character, the markdown tree is re-parsed on **every single token**
- `SyntaxHighlighter` for code blocks is also expensive and re-renders each time

---

## Bottleneck #5: ScrollArea Auto-Scroll Effect Fires Too Often

**File:** `ui/desktop/src/components/ui/scroll-area.tsx`

```tsx
React.useEffect(() => {
  // ...auto-scroll logic
}, [children, autoScroll, isFollowing]);
//                                        ^^^^^^^^ changes on every render!
```

The `children` dependency means this effect runs on **every render** of the chat view. It does a `scrollHeight` comparison (good), but the effect still runs the full evaluation chain unnecessarily.

---

## Bottleneck #6: No Virtual Scrolling

The chat renders **every message** as DOM nodes. With 200 messages, each having:
- Outer container div
- GooseMessage/UserMessage div
- MarkdownContent with potentially dozens of elements (paragraphs, code blocks, tables)
- ToolCallWithResponse with tabs, arguments, status indicators
- Timestamps, icons, copy buttons

That's potentially **1000-5000 DOM nodes** for a long chat. Browsers can handle this, but React's reconciliation becomes expensive.

---

## Bottleneck #7: Thinking Append Causes Layout Jumps

From `useChatStream.ts`:

```typescript
case 'Message': {
  currentMessages = pushMessage(currentMessages, msg);
  maybeUpdateUI(tokenState, ChatState.X); // triggers SET_MESSAGES dispatch
}
```

Each SSE `Message` event appends to a thinking block's text, creates a new array, and dispatches `SET_MESSAGES`. This cascades through the entire render pipeline. The layout "jumps" because:
1. New thinking text changes the height of the message
2. The scroll-area's auto-scroll effect fires
3. But if the user scrolled up, `isFollowing` is false, so no scroll correction
4. The message list shifts visually, and content below the viewport moves

---

## Recommended Optimizations (by impact)

### P0: Message-Level Memoization (Highest ROI, Lowest Risk)

Wrap each message component in `React.memo` and ensure their props are stable references. This alone could cut rendering time by 80-90% during streaming.

Key changes:
- `GooseMessage` → wrap in `React.memo`
- `UserMessage` → wrap in `React.memo`  
- `ToolCallWithResponse` → already has some memoization internally
- Make `toolCallNotifications` map stable via `useMemo` in `ProgressiveMessageList`
- Derive per-message props outside the `.map()` to avoid new closures

### P1: Compute Message Indices Once

Move `messageIndex` computation from inside each `GooseMessage` (where it does `findIndex` — O(n) per message) to `ProgressiveMessageList` where it's just the loop index. Pass it as a prop.

### P2: Bottom-Up Rendering for Large Chats

For chats above a threshold (e.g., >100 messages), render from the bottom up:
- Start with the last `batchSize` messages
- Scroll to bottom immediately
- Fill upwards in background batches
- This way the user sees content they care about first

Alternatively, use the `initialRenderRef` in `BaseChat` to skip progressive rendering entirely for loaded chats — render all at once and scroll to bottom. Progressive loading helps when the user is on a new chat; it hurts when opening old ones.

### P3: Fix ScrollArea Dependency

Remove `children` from the auto-scroll `useEffect` dependency. The `scrollHeight` check is the only thing that matters, so use a ref instead:

```tsx
const childrenHeightRef = useRef(0);
childrenHeightRef.current = viewportRef.current?.scrollHeight ?? 0;

React.useEffect(() => {
  if (!autoScroll || !viewportRef.current) return;
  const viewport = viewportRef.current;
  const currentScrollHeight = childrenHeightRef.current;
  // ... auto-scroll logic
}, [autoScroll, isFollowing]); // no children dependency
```

### P4: Virtual Scrolling (Long-Term)

Replace the plain message list with a virtualized list. Options:
- `react-window` / `react-virtual` — lightweight, proven
- `tanstack-virtual` — more feature-rich
- Window only the messages currently visible + a small buffer

This is the nuclear option for very long chats (1000+ messages) but adds significant complexity.

### P5: Streaming Update Batching

During active streaming, debounce `SET_MESSAGES` dispatches so they don't fire on every SSE event. The `reduceMotion` batching already does this for reduced-motion users — extend it to always batch during streaming (e.g., 100ms window):

```typescript
const streamingBufferRef = useRef<Message[]>([]);
const flushTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

// In SSE event handler:
streamingBufferRef.current = currentMessages;
if (!flushTimeoutRef.current) {
  flushTimeoutRef.current = setTimeout(() => {
    dispatch({ type: 'SET_MESSAGES', payload: streamingBufferRef.current });
    streamingBufferRef.current = [];
    flushTimeoutRef.current = undefined;
  }, 100);
}
```

This would reduce render frequency from potentially hundreds per second (token-by-token) to ~10 during streaming.

---

## Files to Modify

| File | Change | Effort |
|---|---|---|
| `ui/desktop/src/components/ProgressiveMessageList.tsx` | Pass index as prop, memoize maps, consider bottom-up | Medium |
| `ui/desktop/src/components/GooseMessage.tsx` | Wrap in React.memo, accept index prop | Small |
| `ui/desktop/src/components/UserMessage.tsx` | Wrap in React.memo | Small |
| `ui/desktop/src/components/ToolCallWithResponse.tsx` | Memoize `toolResponsesMap` | Small |
| `ui/desktop/src/components/BaseChat.tsx` | Remove progressive render for loaded chats, memoize `commandHistory` | Small |
| `ui/desktop/src/components/ui/scroll-area.tsx` | Fix `children` dependency | Trivial |
| `ui/desktop/src/hooks/useChatStream.ts` | Batch streaming updates | Medium |
| `ui/desktop/src/utils/toolCallChaining.ts` | (Optional) Cache results per session | Small |

---

## Proposed Implementation Order

1. **P3** — ScrollArea fix (trivial, low risk)
2. **P0** — Message-level memoization (highest ROI)
3. **P1** — Index computation
4. **P5** — Streaming update batching
5. **P2** — Bottom-up rendering for large chats
6. **P4** — Virtual scrolling (long-term, depends on whether P0-P2 solve the problem enough)
