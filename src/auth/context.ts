import { createContext } from "react";

import type { AuthSession } from "@/auth/types";

export const AuthContext = createContext<AuthSession | null>(null);
