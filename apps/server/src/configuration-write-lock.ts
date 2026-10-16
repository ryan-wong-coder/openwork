const writes = new Map<string, Promise<void>>();

/** Serialize local configuration compare-and-swap operations, including global files. */
export async function withConfigurationWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  writes.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (writes.get(key) === current) writes.delete(key);
  }
}
