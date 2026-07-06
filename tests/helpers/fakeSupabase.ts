export function createFakeSupabase(results: Array<{ data: any; error: any }>) {
  let i = 0;
  const next = () => results[Math.min(i++, results.length - 1)];
  const builder: any = {
    from: () => builder,
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    insert: () => builder,
    update: () => builder,
    upsert: () => builder,
    maybeSingle: () => Promise.resolve(next()),
    single: () => Promise.resolve(next()),
    then: (resolve: (value: { data: any; error: any }) => void) => resolve(next()),
  };
  return builder;
}
