
import type { APIRoute } from "astro";
import crypto from "crypto";
import { adminDb, FieldValue } from "@/lib/firebase/firebase-admin";

export const POST: APIRoute = async ({ request }) => {
    try {
        const signature = request.headers.get("x-paystack-signature");
        if (!signature) {
            return new Response("No signature provided", { status: 400 });
        }

        const body = await request.text();
        const secret = import.meta.env.PAYSTACK_SECRET_KEY;

        // Verify signature
        const hash = crypto
            .createHmac("sha512", secret)
            .update(body)
            .digest("hex");

        if (hash !== signature) {
            return new Response("Invalid signature", { status: 401 });
        }

        const event = JSON.parse(body);

        // Handle charge.success
        if (event.event === "charge.success") {
            const { metadata, reference, amount, status } = event.data;
            const uid = metadata?.uid;
            const type = metadata?.type; // 'subscription' or 'credits'

            if (!uid) {
                console.error("Webhook: Missing UID in metadata");
                return new Response("Missing UID", { status: 200 }); // Return 200 to stop retries
            }

            // 1. Check if transaction already processed
            const transactionRef = adminDb.collection("transactions").doc(reference);
            const transactionDoc = await transactionRef.get();

            if (transactionDoc.exists) {
                console.log(`Transaction ${reference} already processed`);
                return new Response("Already processed", { status: 200 });
            }

            // 2. Process based on type
            const userRef = adminDb.collection("users").doc(uid);
            const updates: any = {
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (type === "credits") {
                const pkg = metadata.package;
                let creditsToAdd = 0;

                if (pkg === "mini") creditsToAdd = 250;
                else if (pkg === "starter") creditsToAdd = 500;
                else if (pkg === "creator") creditsToAdd = 1500;
                else if (pkg === "studio") creditsToAdd = 5000;
                else {
                    // Fallback if package name missing but type is credits? 
                    // Unlikely if initialized correctly.
                    console.warn("Unknown credit package:", pkg);
                }

                if (creditsToAdd > 0) {
                    updates.credits = FieldValue.increment(creditsToAdd);
                }

            } else if (type === "subscription") {
                // Pro Plan
                updates.isPro = true;
                // Set subscription ID if available from Paystack data
                if (event.data.subscription_code) {
                    updates.subscriptionId = event.data.subscription_code;
                }

                // Add monthly credits (2000)
                // Note: If this is a recurring charge, this webhook will fire again.
                // We simply add 2000 credits every time a subscription payment succeeds.
                updates.credits = FieldValue.increment(2000);
            }

            // 3. Update User and Create Transaction Record Atomically
            const batch = adminDb.batch();

            batch.update(userRef, updates);

            batch.set(transactionRef, {
                uid,
                reference,
                amount,
                type,
                metadata,
                status,
                event: event.event,
                createdAt: FieldValue.serverTimestamp(),
            });

            await batch.commit();
            console.log(`Processed ${type} payment for user ${uid}`);

        }

        return new Response("Webhook received", { status: 200 });

    } catch (error) {
        console.error("Webhook Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};
