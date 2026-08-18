/** Matches the `now: () => number` idiom already used by TtlCache and the call session store — no adapter class needed. */
export type Clock = () => number;
