/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="motion" />


declare namespace App {
    interface Locals {
        user?: {
            uid: string;
            email: string | undefined;
            emailVerified: boolean;
        };
    }
}