import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { parsePermissions, type Permissions } from "@/lib/permissions";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email:    { label: "Username or email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Login id may be a username OR an email (matched case-insensitively).
        const rows = await query<{ id: string; email: string; name: string; password: string; role: string; permissions: unknown; active: boolean }>(
          `SELECT id, email, name, password, role, permissions, active FROM "User" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [credentials.email.trim()]
        );
        const user = rows[0];
        if (!user || !user.password || user.active === false) return null;

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role, permissions: parsePermissions(user.permissions) } as {
          id: string; email: string; name: string; role: string; permissions: Permissions;
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days — stays logged in across refreshes
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { role?: string; permissions?: Permissions };
        token.role = u.role;
        token.permissions = u.permissions;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const s = session.user as { id?: string; role?: string; permissions?: Permissions };
        s.id = token.sub;
        s.role = token.role as string;
        s.permissions = (token.permissions as Permissions) ?? null;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error:  "/login",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
