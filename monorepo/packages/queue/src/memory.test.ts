import { describe, expect, it } from "vitest";
import { InMemoryQueueProvider } from "./memory.js";
import { createQueueProvider } from "./index.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("in-memory queue provider", () => {
  it("delivers added jobs to a registered worker", async () => {
    const p = new InMemoryQueueProvider();
    const seen: number[] = [];
    p.worker<number>("inbound", async (n) => {
      seen.push(n);
    });
    await p.queue<number>("inbound").add(1);
    await p.queue<number>("inbound").add(2);
    expect(seen).toEqual([1, 2]);
  });

  it("buffers jobs added before the worker, then drains them", async () => {
    const p = new InMemoryQueueProvider();
    await p.queue<string>("outbound").add("a");
    const seen: string[] = [];
    p.worker<string>("outbound", async (s) => {
      seen.push(s);
    });
    await tick();
    expect(seen).toEqual(["a"]);
  });

  it("routes a failing job to the dead-letter queue", async () => {
    const p = new InMemoryQueueProvider();
    const dead: Array<{ queue: string }> = [];
    p.worker("dead-letter", async (d) => {
      dead.push(d as { queue: string });
    });
    p.worker("notification", async () => {
      throw new Error("boom");
    });
    await p.queue("notification").add({ x: 1 });
    expect(dead).toHaveLength(1);
    expect(dead[0]!.queue).toBe("notification");
  });

  it("createQueueProvider() with no Redis URL → in-memory", () => {
    expect(createQueueProvider()).toBeInstanceOf(InMemoryQueueProvider);
  });
});
