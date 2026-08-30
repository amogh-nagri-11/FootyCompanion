import jwt from "jsonwebtoken"; 
import { config } from "./config.js"; 

export interface AuthedUser { 
    id: string; 
    email?: string; 
}

export function verifyToken(token: string): AuthedUser {
    const payload = jwt.verify(token, config.supabaseJwtSecret) as jwt.JwtPayload; 
    if (!payload.sub) throw new Error('Token missing sub claim');
    return { id: payload.sub, email: payload.email as string | undefined };
}

