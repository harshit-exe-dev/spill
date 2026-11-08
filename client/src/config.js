// Local dev talks to the API on 4100; production sets VITE_API_URL.
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4100";
