/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: {
      human_id: string;
      nickname: string;
      color: string;
      avatar_version: number | null;
      role: 'user' | 'admin';
      account_status: 'active' | 'blocked' | 'set_for_deletion';
      deletion_at: Date | null;
      created_at: Date;
      updated_at: Date;
    } | null;
  }
}