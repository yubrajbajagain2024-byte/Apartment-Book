/**
 * Hand-written Supabase database types. Keep in sync with
 * supabase/migrations/*.sql. You can regenerate this file with
 *   npx supabase gen types typescript --project-id <ref> > packages/shared/src/types/database.ts
 * once the Supabase CLI is installed.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      universities: {
        Row: {
          id: string;
          name: string;
          city: string | null;
          country: string | null;
          latitude: number | null;
          longitude: number | null;
          email_domain: string | null;
          geog: unknown | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          city?: string | null;
          country?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          email_domain?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          city?: string | null;
          country?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          email_domain?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      profile_classes: {
        Row: {
          id: string;
          user_id: string;
          term: string;
          code: string;
          title: string | null;
          section: string | null;
          meetings: Json;
          location: string | null;
          course_group_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          term: string;
          code: string;
          title?: string | null;
          section?: string | null;
          meetings?: Json;
          location?: string | null;
          course_group_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          term?: string;
          code?: string;
          title?: string | null;
          section?: string | null;
          meetings?: Json;
          location?: string | null;
          course_group_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_classes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_classes_course_group_id_fkey";
            columns: ["course_group_id"];
            isOneToOne: false;
            referencedRelation: "course_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      course_groups: {
        Row: {
          id: string;
          university_id: string;
          term: string;
          code: string;
          section: string;
          conversation_id: string;
          reminded_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          university_id: string;
          term: string;
          code: string;
          section: string;
          conversation_id: string;
          reminded_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          university_id?: string;
          term?: string;
          code?: string;
          section?: string;
          conversation_id?: string;
          reminded_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_groups_university_id_fkey";
            columns: ["university_id"];
            isOneToOne: false;
            referencedRelation: "universities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_groups_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: true;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          avatar_url: string | null;
          university_id: string | null;
          program: string | null;
          graduation_year: number | null;
          bio: string | null;
          notify_nearby_listings: boolean;
          /** Retired by migration 22: always null (installed old builds still select it). See activity_status. */
          last_seen_at: string | null;
          show_active_status: boolean;
          username: string;
          classes_visibility: string;
          saved_visibility: string;
          liked_visibility: string;
          /** Migration 37: who sees the Listings tab. Missing on a database before it. */
          listings_visibility: string;
          /** Migration 39: student | business_owner | business_staff | admin. Set only by the database (see roleOf()). */
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          avatar_url?: string | null;
          university_id?: string | null;
          program?: string | null;
          graduation_year?: number | null;
          bio?: string | null;
          notify_nearby_listings?: boolean;
          last_seen_at?: string | null;
          show_active_status?: boolean;
          username?: string;
          classes_visibility?: string;
          saved_visibility?: string;
          liked_visibility?: string;
          listings_visibility?: string;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          avatar_url?: string | null;
          university_id?: string | null;
          program?: string | null;
          graduation_year?: number | null;
          bio?: string | null;
          notify_nearby_listings?: boolean;
          last_seen_at?: string | null;
          show_active_status?: boolean;
          username?: string;
          classes_visibility?: string;
          saved_visibility?: string;
          liked_visibility?: string;
          listings_visibility?: string;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_university_id_fkey";
            columns: ["university_id"];
            isOneToOne: false;
            referencedRelation: "universities";
            referencedColumns: ["id"];
          },
        ];
      };
      apartments: {
        Row: {
          id: string;
          owner_id: string;
          university_id: string | null;
          title: string;
          description: string;
          price_per_month: number;
          currency: string;
          address: string;
          city: string | null;
          distance_km: number | null;
          bedrooms: number;
          bathrooms: number;
          furnished: boolean;
          utilities_included: boolean;
          pets_allowed: boolean;
          available_from: string | null;
          lease_months: number | null;
          amenities: string[];
          images: string[];
          image_meta: Json;
          videos: Json;
          has_video: boolean;
          map_url: string | null;
          contact_phone: string | null;
          latitude: number | null;
          longitude: number | null;
          geog: unknown | null;
          status: Database["public"]["Enums"]["listing_status"];
          /** Migration 39: the business this listing was posted for from the portal; null for a student's own. */
          business_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          university_id?: string | null;
          title: string;
          description?: string;
          price_per_month: number;
          currency?: string;
          address: string;
          city?: string | null;
          distance_km?: number | null;
          bedrooms?: number;
          bathrooms?: number;
          furnished?: boolean;
          utilities_included?: boolean;
          pets_allowed?: boolean;
          available_from?: string | null;
          lease_months?: number | null;
          amenities?: string[];
          images?: string[];
          image_meta?: Json;
          videos?: Json;
          has_video?: boolean;
          map_url?: string | null;
          contact_phone?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          status?: Database["public"]["Enums"]["listing_status"];
          business_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          university_id?: string | null;
          title?: string;
          description?: string;
          price_per_month?: number;
          currency?: string;
          address?: string;
          city?: string | null;
          distance_km?: number | null;
          bedrooms?: number;
          bathrooms?: number;
          furnished?: boolean;
          utilities_included?: boolean;
          pets_allowed?: boolean;
          available_from?: string | null;
          lease_months?: number | null;
          amenities?: string[];
          images?: string[];
          image_meta?: Json;
          videos?: Json;
          has_video?: boolean;
          map_url?: string | null;
          contact_phone?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          status?: Database["public"]["Enums"]["listing_status"];
          business_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "apartments_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "apartments_university_id_fkey";
            columns: ["university_id"];
            isOneToOne: false;
            referencedRelation: "universities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "apartments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      roommate_posts: {
        Row: {
          id: string;
          /** Null on an anonymous roommate post (20261105000000_anonymous_listings.sql): its poster is in anonymous_listing_owners, readable by them alone. */
          author_id: string | null;
          university_id: string | null;
          post_type: Database["public"]["Enums"]["roommate_post_type"];
          title: string;
          description: string;
          budget_min: number | null;
          budget_max: number | null;
          currency: string;
          move_in_date: string | null;
          location: string | null;
          gender_preference: Database["public"]["Enums"]["gender_pref"];
          smoking_ok: boolean;
          pets_ok: boolean;
          sleep_schedule: string | null;
          cleanliness: string | null;
          images: string[];
          image_meta: Json;
          videos: Json;
          has_video: boolean;
          latitude: number | null;
          longitude: number | null;
          distance_km: number | null;
          geog: unknown | null;
          is_active: boolean;
          /** Posted without its poster's name; fixed once posted. */
          is_anonymous: boolean;
          /** Who can see it: campus, global or friends (ListingAudience). */
          audience: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          author_id: string;
          university_id?: string | null;
          post_type: Database["public"]["Enums"]["roommate_post_type"];
          title: string;
          description?: string;
          budget_min?: number | null;
          budget_max?: number | null;
          currency?: string;
          move_in_date?: string | null;
          location?: string | null;
          gender_preference?: Database["public"]["Enums"]["gender_pref"];
          smoking_ok?: boolean;
          pets_ok?: boolean;
          sleep_schedule?: string | null;
          cleanliness?: string | null;
          images?: string[];
          image_meta?: Json;
          videos?: Json;
          has_video?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          distance_km?: number | null;
          is_active?: boolean;
          is_anonymous?: boolean;
          audience?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          author_id?: string | null;
          university_id?: string | null;
          post_type?: Database["public"]["Enums"]["roommate_post_type"];
          title?: string;
          description?: string;
          budget_min?: number | null;
          budget_max?: number | null;
          currency?: string;
          move_in_date?: string | null;
          location?: string | null;
          gender_preference?: Database["public"]["Enums"]["gender_pref"];
          smoking_ok?: boolean;
          pets_ok?: boolean;
          sleep_schedule?: string | null;
          cleanliness?: string | null;
          images?: string[];
          image_meta?: Json;
          videos?: Json;
          has_video?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          distance_km?: number | null;
          is_active?: boolean;
          is_anonymous?: boolean;
          audience?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "roommate_posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roommate_posts_university_id_fkey";
            columns: ["university_id"];
            isOneToOne: false;
            referencedRelation: "universities";
            referencedColumns: ["id"];
          },
        ];
      };
      items: {
        Row: {
          id: string;
          /** Null on an anonymous item (20261105000000_anonymous_listings.sql): its poster is in anonymous_listing_owners, readable by them alone. */
          seller_id: string | null;
          university_id: string | null;
          title: string;
          description: string;
          price: number;
          currency: string;
          category: string;
          condition: Database["public"]["Enums"]["item_condition"];
          images: string[];
          image_meta: Json;
          pickup_location: string | null;
          status: Database["public"]["Enums"]["item_status"];
          /** Posted without its poster's name; fixed once posted. */
          is_anonymous: boolean;
          /** Who can see it: campus, global or friends (ListingAudience). */
          audience: string;
          created_at: string;
          updated_at: string;
          /** Migration 43 (marketplace video): a video snapshot, at most one (absent on a database without it). */
          videos: Json;
          has_video: boolean;
        };
        Insert: {
          id?: string;
          seller_id: string;
          university_id?: string | null;
          title: string;
          description?: string;
          price: number;
          currency?: string;
          category: string;
          condition?: Database["public"]["Enums"]["item_condition"];
          images?: string[];
          image_meta?: Json;
          pickup_location?: string | null;
          videos?: Json;
          has_video?: boolean;
          status?: Database["public"]["Enums"]["item_status"];
          is_anonymous?: boolean;
          audience?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string | null;
          university_id?: string | null;
          title?: string;
          description?: string;
          price?: number;
          currency?: string;
          category?: string;
          condition?: Database["public"]["Enums"]["item_condition"];
          images?: string[];
          image_meta?: Json;
          pickup_location?: string | null;
          videos?: Json;
          has_video?: boolean;
          status?: Database["public"]["Enums"]["item_status"];
          is_anonymous?: boolean;
          audience?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "items_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_university_id_fkey";
            columns: ["university_id"];
            isOneToOne: false;
            referencedRelation: "universities";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_listings: {
        Row: {
          user_id: string;
          target_type: string;
          target_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          target_type: string;
          target_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          target_type?: string;
          target_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_listings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          type: Database["public"]["Enums"]["conversation_type"];
          name: string | null;
          direct_key: string | null;
          created_by: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          /** Migration 39: an inquiry chat with this business (every team member is in it), started from this listing or deal. */
          business_id: string | null;
          inquiry_target_type: string | null;
          inquiry_target_id: string | null;
          /**
           * 20261105000000_anonymous_listings.sql: a chat with the anonymous poster of the listing in inquiry_target_*, who
           * stays hidden from the other person until they show who they are (poster_revealed_at). Set only by
           * start_listing_inquiry() and reveal_listing_identity().
           */
          poster_hidden: boolean;
          poster_revealed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type?: Database["public"]["Enums"]["conversation_type"];
          name?: string | null;
          direct_key?: string | null;
          created_by?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          business_id?: string | null;
          inquiry_target_type?: string | null;
          inquiry_target_id?: string | null;
          poster_hidden?: boolean;
          poster_revealed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          type?: Database["public"]["Enums"]["conversation_type"];
          name?: string | null;
          direct_key?: string | null;
          created_by?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          business_id?: string | null;
          inquiry_target_type?: string | null;
          inquiry_target_id?: string | null;
          poster_hidden?: boolean;
          poster_revealed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          user_id: string;
          joined_at: string;
          last_read_at: string;
          last_delivered_at: string;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          joined_at?: string;
          last_read_at?: string;
          last_delivered_at?: string;
        };
        Update: {
          conversation_id?: string;
          user_id?: string;
          joined_at?: string;
          last_read_at?: string;
          last_delivered_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string | null;
          content: string;
          image_url: string | null;
          shared_post: Json | null;
          /** Migration 20: [{kind, path, name, size, mime, width?, height?, duration?}]; read it with parseAttachments(). */
          attachments: Json;
          /** Migration 28: {id, kind, expires_at, opened_at} when the message is a Snap; read it with snapOf(). Set only by send_snap(). */
          snap: Json | null;
          /**
           * Migration 31: {id, sender_id, kind, text} when the message answers another one of the chat; read it with
           * replyOf(). Send only {id}: a trigger builds the rest from the original and refuses anything else.
           */
          reply_to: Json | null;
          /** Migration 35: {id, kind, status, ended_reason, duration, started_by} when the message is a call's row in the chat; read it with callOf(). Written only by the call functions. */
          call: Json | null;
          /** A hidden anonymous poster's message (20261105000000_anonymous_listings.sql): stored with no sender. Set only by the database. */
          anonymous: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id?: string | null;
          content: string;
          image_url?: string | null;
          shared_post?: Json | null;
          attachments?: Json;
          snap?: Json | null;
          reply_to?: Json | null;
          call?: Json | null;
          anonymous?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string | null;
          content?: string;
          image_url?: string | null;
          shared_post?: Json | null;
          attachments?: Json;
          snap?: Json | null;
          reply_to?: Json | null;
          call?: Json | null;
          anonymous?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Migration 35: an audio or video call in a chat; its rows are written only by the call functions. */
      calls: {
        Row: {
          id: string;
          conversation_id: string;
          started_by: string | null;
          kind: string;
          status: string;
          ended_reason: string | null;
          message_id: string | null;
          started_at: string;
          answered_at: string | null;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          started_by?: string | null;
          kind: string;
          status?: string;
          ended_reason?: string | null;
          message_id?: string | null;
          started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          started_by?: string | null;
          kind?: string;
          status?: string;
          ended_reason?: string | null;
          message_id?: string | null;
          started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "calls_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Migration 35: everyone a call rang, and where each of them stands. */
      call_participants: {
        Row: {
          call_id: string;
          user_id: string;
          state: string;
          invited_at: string;
          joined_at: string | null;
          left_at: string | null;
        };
        Insert: {
          call_id: string;
          user_id: string;
          state?: string;
          invited_at?: string;
          joined_at?: string | null;
          left_at?: string | null;
        };
        Update: {
          call_id?: string;
          user_id?: string;
          state?: string;
          invited_at?: string;
          joined_at?: string | null;
          left_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "call_participants_call_id_fkey";
            columns: ["call_id"];
            isOneToOne: false;
            referencedRelation: "calls";
            referencedColumns: ["id"];
          },
        ];
      };
      device_push_tokens: {
        Row: {
          id: string;
          user_id: string;
          token: string;
          platform: string;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token: string;
          platform: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          token?: string;
          platform?: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      media: {
        Row: {
          id: string;
          owner_id: string;
          kind: string;
          provider: string;
          provider_upload_id: string | null;
          provider_asset_id: string | null;
          playback_id: string | null;
          status: string;
          error: string | null;
          duration_seconds: number | null;
          width: number | null;
          height: number | null;
          aspect_ratio: string | null;
          poster_url: string | null;
          size_bytes: number | null;
          original_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          kind?: string;
          provider?: string;
          provider_upload_id?: string | null;
          provider_asset_id?: string | null;
          playback_id?: string | null;
          status?: string;
          error?: string | null;
          duration_seconds?: number | null;
          width?: number | null;
          height?: number | null;
          aspect_ratio?: string | null;
          poster_url?: string | null;
          size_bytes?: number | null;
          original_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          kind?: string;
          provider?: string;
          provider_upload_id?: string | null;
          provider_asset_id?: string | null;
          playback_id?: string | null;
          status?: string;
          error?: string | null;
          duration_seconds?: number | null;
          width?: number | null;
          height?: number | null;
          aspect_ratio?: string | null;
          poster_url?: string | null;
          size_bytes?: number | null;
          original_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "media_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_likes: {
        Row: {
          target_type: string;
          target_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          target_type: string;
          target_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          target_type?: string;
          target_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_comments: {
        Row: {
          id: string;
          target_type: string;
          target_id: string;
          user_id: string;
          body: string;
          parent_id: string | null;
          score: number;
          likes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          target_type: string;
          target_id: string;
          user_id: string;
          body: string;
          parent_id?: string | null;
          score?: number;
          likes?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          target_type?: string;
          target_id?: string;
          user_id?: string;
          body?: string;
          parent_id?: string | null;
          score?: number;
          likes?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "post_comments";
            referencedColumns: ["id"];
          },
        ];
      };
      post_comment_votes: {
        Row: {
          comment_id: string;
          user_id: string;
          value: number;
          created_at: string;
        };
        Insert: {
          comment_id: string;
          user_id: string;
          value: number;
          created_at?: string;
        };
        Update: {
          comment_id?: string;
          user_id?: string;
          value?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_comment_votes_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "post_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_comment_votes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      blocks: {
        Row: {
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          blocker_id: string;
          blocked_id: string;
          created_at?: string;
        };
        Update: {
          blocker_id?: string;
          blocked_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          target_type: string;
          target_id: string;
          reason: string;
          details: string | null;
          status: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          decision: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          target_type: string;
          target_id: string;
          reason: string;
          details?: string | null;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          decision?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          target_type?: string;
          target_id?: string;
          reason?: string;
          details?: string | null;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          decision?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** 20261105000000_anonymous_listings.sql: who posted an anonymous listing. Each poster reads only their own rows; nobody writes them. */
      anonymous_listing_owners: {
        Row: { id: string; owner_id: string; roommate_post_id: string | null; item_id: string | null; created_at: string };
        Insert: { id?: string; owner_id: string; roommate_post_id?: string | null; item_id?: string | null; created_at?: string };
        Update: { id?: string; owner_id?: string; roommate_post_id?: string | null; item_id?: string | null; created_at?: string };
        Relationships: [];
      };
      /** The same migration: the anonymous poster in an inquiry chat. Read by that poster alone. */
      anonymous_chat_posters: {
        Row: { conversation_id: string; user_id: string; created_at: string };
        Insert: { conversation_id: string; user_id: string; created_at?: string };
        Update: { conversation_id?: string; user_id?: string; created_at?: string };
        Relationships: [];
      };
      feed_post_viewers: {
        Row: { post_id: string; user_id: string; created_at: string };
        Insert: { post_id: string; user_id: string; created_at?: string };
        Update: { post_id?: string; user_id?: string; created_at?: string };
        Relationships: [];
      };
      feed_posts: {
        Row: {
          id: string;
          author_id: string;
          university_id: string | null;
          kind: string;
          body: string;
          images: string[];
          image_meta: Json;
          videos: Json;
          has_video: boolean;
          pinned_at: string | null;
          title: string | null;
          link_url: string | null;
          audience: string;
          comments_off: boolean;
          /** Migration 44: the #tags of `body`, lowercased (extract_hashtags), kept by Postgres. Missing on a database before it. */
          hashtags?: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          author_id: string;
          university_id?: string | null;
          kind?: string;
          body?: string;
          images?: string[];
          image_meta?: Json;
          videos?: Json;
          has_video?: boolean;
          pinned_at?: string | null;
          title?: string | null;
          link_url?: string | null;
          audience?: string;
          comments_off?: boolean;
          hashtags?: never;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          author_id?: string;
          university_id?: string | null;
          kind?: string;
          body?: string;
          images?: string[];
          image_meta?: Json;
          videos?: Json;
          has_video?: boolean;
          pinned_at?: string | null;
          title?: string | null;
          link_url?: string | null;
          audience?: string;
          comments_off?: boolean;
          hashtags?: never;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feed_posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feed_posts_university_id_fkey";
            columns: ["university_id"];
            isOneToOne: false;
            referencedRelation: "universities";
            referencedColumns: ["id"];
          },
        ];
      };
      follows: {
        Row: {
          follower_id: string;
          followee_id: string;
          created_at: string;
        };
        Insert: {
          follower_id: string;
          followee_id: string;
          created_at?: string;
        };
        Update: {
          follower_id?: string;
          followee_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_followee_id_fkey";
            columns: ["followee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_mutes: {
        Row: {
          id: string;
          user_id: string;
          scope: string;
          target_id: string | null;
          until: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scope: string;
          target_id?: string | null;
          until?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          scope?: string;
          target_id?: string | null;
          until?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_mutes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          actor_id: string | null;
          type: string;
          title: string;
          body: string | null;
          link: string | null;
          data: Json;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          actor_id?: string | null;
          type: string;
          title: string;
          body?: string | null;
          link?: string | null;
          data?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          actor_id?: string | null;
          type?: string;
          title?: string;
          body?: string | null;
          link?: string | null;
          data?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Migration 39: a business on the portal. Public once approved; its own team sees it at every status. */
      businesses: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          category: string;
          description: string;
          website: string | null;
          phone: string | null;
          contact_email: string | null;
          address: string | null;
          city: string | null;
          logo_url: string | null;
          /** The campuses it serves; empty = every campus. */
          university_ids: string[];
          /** pending | approved | rejected | suspended. Changed only by admin_review_business(). */
          status: string;
          /** "Verified Partner" on its listings: an admin verified it (admin_set_verified), with what was checked on record. */
          verified_partner: boolean;
          verified_at: string | null;
          /** Not readable by students (column grants): only through my_business() and the admin functions. */
          verified_by: string | null;
          verification_note: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          created_at: string;
          updated_at: string;
          /** Opening hours (migration 57): { timezone, week, special }, read with parseBusinessHours(); null for none. Public. */
          hours: Json | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          category?: string;
          description?: string;
          website?: string | null;
          phone?: string | null;
          contact_email?: string | null;
          address?: string | null;
          city?: string | null;
          logo_url?: string | null;
          hours?: Json | null;
          university_ids?: string[];
          status?: string;
          verified_partner?: boolean;
          verified_at?: string | null;
          verified_by?: string | null;
          verification_note?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          category?: string;
          description?: string;
          website?: string | null;
          phone?: string | null;
          contact_email?: string | null;
          address?: string | null;
          city?: string | null;
          logo_url?: string | null;
          hours?: Json | null;
          university_ids?: string[];
          status?: string;
          verified_partner?: boolean;
          verified_at?: string | null;
          verified_by?: string | null;
          verification_note?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "businesses_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Migration 39: the team of a business (one business per account); rows are made by the sign-up trigger. */
      business_members: {
        Row: {
          user_id: string;
          business_id: string;
          role: string;
          invited_by: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          business_id: string;
          role?: string;
          invited_by?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          business_id?: string;
          role?: string;
          invited_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_members_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Migration 39: an address the owner invited; written only by business_invite_create(). */
      business_invites: {
        Row: {
          id: string;
          business_id: string;
          email: string;
          token: string;
          invited_by: string | null;
          created_at: string;
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          /** Migration 49: what the invite joins as: admin | editor | analyst. */
          role: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          email: string;
          role?: string;
          token?: string;
          invited_by?: string | null;
          created_at?: string;
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
        };
        Update: {
          id?: string;
          business_id?: string;
          email?: string;
          token?: string;
          invited_by?: string | null;
          created_at?: string;
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_invites_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_invites_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * Migration 39: a business's offer with campus targeting; students see it while active and the business is approved.
       * Since migration 50 every business post (the table kept its name): kind, media, price, event date.
       */
      deals: {
        Row: {
          id: string;
          business_id: string;
          title: string;
          description: string;
          discount_label: string | null;
          code: string | null;
          link_url: string | null;
          image_url: string | null;
          /** The campuses whose students see it; empty = every campus. */
          university_ids: string[];
          starts_at: string;
          ends_at: string | null;
          /** active | paused | archived */
          status: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          /** Migration 50: update | product | service | deal | event | promotion. */
          kind: string;
          /** Migration 50: up to 10 photos or one video ({type, url} / {type, media_id, playback_id, poster_url, width, height, duration_seconds}). */
          media: Json;
          price_cents: number | null;
          currency: string;
          /** When an event happens (kind 'event' only). */
          event_at: string | null;
        };
        Insert: {
          id?: string;
          business_id: string;
          title: string;
          description?: string;
          discount_label?: string | null;
          code?: string | null;
          link_url?: string | null;
          image_url?: string | null;
          university_ids?: string[];
          starts_at?: string;
          ends_at?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          kind?: string;
          media?: Json;
          price_cents?: number | null;
          currency?: string;
          event_at?: string | null;
        };
        Update: {
          id?: string;
          business_id?: string;
          title?: string;
          description?: string;
          discount_label?: string | null;
          code?: string | null;
          link_url?: string | null;
          image_url?: string | null;
          university_ids?: string[];
          starts_at?: string;
          ends_at?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          kind?: string;
          media?: Json;
          price_cents?: number | null;
          currency?: string;
          event_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "deals_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Migration 39: a paid promotion of a listing or deal, recorded by an admin; only an active one running now makes it "Sponsored". */
      listing_promotions: {
        Row: {
          id: string;
          /** Null once the business was deleted (migration 56 keeps its payments on record). */
          business_id: string | null;
          apartment_id: string | null;
          deal_id: string | null;
          starts_at: string;
          ends_at: string;
          amount_cents: number;
          currency: string;
          payment_reference: string;
          status: string;
          created_by: string | null;
          created_at: string;
          cancelled_at: string | null;
          /** Migration 50: the ad this payment is for (the table is the ledger of ad payments now). */
          ad_id: string | null;
        };
        Insert: {
          id?: string;
          business_id: string;
          apartment_id?: string | null;
          deal_id?: string | null;
          starts_at: string;
          ends_at: string;
          amount_cents: number;
          currency?: string;
          payment_reference: string;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          cancelled_at?: string | null;
          ad_id?: string | null;
        };
        Update: {
          id?: string;
          business_id?: string;
          apartment_id?: string | null;
          deal_id?: string | null;
          starts_at?: string;
          ends_at?: string;
          amount_cents?: number;
          currency?: string;
          payment_reference?: string;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          cancelled_at?: string | null;
          ad_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "listing_promotions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * Migration 50: a business's ad. The team writes drafts (and rejected ads); the status moves only through the ad_*
       * and admin_*_ad functions. Students never read this table: they get ads from ads_for_feed().
       */
      ads: {
        Row: {
          id: string;
          business_id: string;
          created_by: string | null;
          name: string;
          /** awareness | traffic | engagement | messages */
          objective: string;
          /** general | housing (set by the database) */
          vertical: string;
          /** for_you | reels | housing */
          placements: string[];
          /** The campuses whose students see it; empty only for v1's promotions (every campus). */
          university_ids: string[];
          headline: string | null;
          caption: string;
          media: Json;
          cta: string;
          cta_url: string | null;
          promoted_deal_id: string | null;
          promoted_apartment_id: string | null;
          budget_cents: number;
          currency: string;
          starts_at: string | null;
          ends_at: string | null;
          /** draft | pending_review | scheduled | active | paused | completed | rejected */
          status: string;
          /** business | admin, while paused */
          paused_by: string | null;
          /** Why it is rejected, paused by the UniBuzz team, ended early, or back in draft. */
          status_reason: string | null;
          review_note: string | null;
          needs_review_reason: string | null;
          fair_housing_flags: string[];
          fair_housing_checked_by: string | null;
          fair_housing_checked_at: string | null;
          submitted_at: string | null;
          submitted_by: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          started_at: string | null;
          completed_at: string | null;
          legacy_promotion_id: string | null;
          /** Migration 56: the promoted post or listing as it was reviewed, which students see (set by the database). */
          promoted_snapshot: Json | null;
          /** Migration 56: what the UniBuzz team last approved it as ({ vertical, flags }); a resume compares. */
          reviewed_screen: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          created_by?: string | null;
          name: string;
          objective?: string;
          placements?: string[];
          university_ids?: string[];
          headline?: string | null;
          caption?: string;
          media?: Json;
          cta?: string;
          cta_url?: string | null;
          promoted_deal_id?: string | null;
          promoted_apartment_id?: string | null;
          budget_cents?: number;
          currency?: string;
          starts_at?: string | null;
          ends_at?: string | null;
        };
        Update: {
          name?: string;
          objective?: string;
          placements?: string[];
          university_ids?: string[];
          headline?: string | null;
          caption?: string;
          media?: Json;
          cta?: string;
          cta_url?: string | null;
          promoted_deal_id?: string | null;
          promoted_apartment_id?: string | null;
          budget_cents?: number;
          currency?: string;
          starts_at?: string | null;
          ends_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ads_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Migration 50: ads a student hid (their own rows). */
      ad_hides: {
        Row: { user_id: string; ad_id: string; created_at: string };
        Insert: { user_id: string; ad_id: string; created_at?: string };
        Update: { user_id?: string; ad_id?: string; created_at?: string };
        Relationships: [];
      };
      /** Migration 50: ads a student saved (their own rows; save_ad() also counts the save). */
      ad_saves: {
        Row: { user_id: string; ad_id: string; created_at: string };
        Insert: { user_id: string; ad_id: string; created_at?: string };
        Update: { user_id?: string; ad_id?: string; created_at?: string };
        Relationships: [];
      };
      /** Migration 50: businesses a student blocked (their own rows). */
      business_blocks: {
        Row: { user_id: string; business_id: string; created_at: string };
        Insert: { user_id: string; business_id: string; created_at?: string };
        Update: { user_id?: string; business_id?: string; created_at?: string };
        Relationships: [];
      };
      // CampConnect Admin's tables (step-admin's migrations 14 to 18, applied to production outside supabase/migrations).
      account_restrictions: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          reason: string;
          internal_note: string | null;
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
          lifted_at: string | null;
          lifted_by: string | null;
          lift_note: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind?: string;
          reason: string;
          internal_note?: string | null;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          lifted_at?: string | null;
          lifted_by?: string | null;
          lift_note?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: string;
          reason?: string;
          internal_note?: string | null;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          lifted_at?: string | null;
          lifted_by?: string | null;
          lift_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "account_restrictions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_restrictions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_restrictions_lifted_by_fkey";
            columns: ["lifted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      media_jobs: {
        Row: {
          id: number;
          kind: string;
          ref: string;
          target_type: string | null;
          target_id: string | null;
          attempts: number;
          last_error: string | null;
          next_attempt_at: string;
          claimed_at: string | null;
          created_at: string;
          done_at: string | null;
        };
        Insert: {
          id?: never;
          kind: string;
          ref: string;
          target_type?: string | null;
          target_id?: string | null;
          attempts?: number;
          last_error?: string | null;
          next_attempt_at?: string;
          claimed_at?: string | null;
          created_at?: string;
          done_at?: string | null;
        };
        Update: {
          id?: never;
          kind?: string;
          ref?: string;
          target_type?: string | null;
          target_id?: string | null;
          attempts?: number;
          last_error?: string | null;
          next_attempt_at?: string;
          claimed_at?: string | null;
          created_at?: string;
          done_at?: string | null;
        };
        Relationships: [];
      };
      staff: {
        Row: {
          user_id: string;
          role: string;
          granted_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          role: string;
          granted_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          role?: string;
          granted_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_audit_log: {
        Row: {
          id: number;
          actor_id: string | null;
          actor_email: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          details: Json;
          created_at: string;
        };
        Insert: {
          id?: never;
          actor_id?: string | null;
          actor_email?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          details?: Json;
          created_at?: string;
        };
        Update: {
          id?: never;
          actor_id?: string | null;
          actor_email?: string | null;
          action?: string;
          target_type?: string | null;
          target_id?: string | null;
          details?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      staff_invites: {
        Row: {
          email: string;
          role: string;
          invited_by: string | null;
          created_at: string;
        };
        Insert: {
          email: string;
          role: string;
          invited_by?: string | null;
          created_at?: string;
        };
        Update: {
          email?: string;
          role?: string;
          invited_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_invites_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      set_post_viewers: {
        Args: { p_post_id: string; p_user_ids: string[] };
        Returns: number;
      };
      start_listing_inquiry: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: string;
      };
      reveal_listing_identity: {
        Args: { p_conversation_id: string };
        Returns: string;
      };
      can_view_profile_section: {
        Args: { p_owner: string; p_section: string };
        Returns: boolean;
      };
      profile_section_access: {
        Args: { p_owner: string };
        Returns: { classes: boolean; saved: boolean; liked: boolean }[];
      };
      profile_visible_sections: {
        Args: { p_owner: string };
        Returns: { classes: boolean; saved: boolean; liked: boolean; listings: boolean }[];
      };
      post_like_count: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: number;
      };
      post_likers_many: {
        Args: { p_target_type: string; p_target_ids: string[]; p_per?: number };
        Returns: { target_id: string; user_id: string; full_name: string; avatar_url: string | null }[];
      };
      profile_saved_items: {
        Args: { p_user_id: string; p_limit?: number; p_before?: string | null; p_before_id?: string | null };
        Returns: { target_type: string; target_id: string; created_at: string }[];
      };
      profile_liked_items: {
        Args: { p_user_id: string; p_limit?: number; p_before?: string | null; p_before_id?: string | null };
        Returns: { target_type: string; target_id: string; created_at: string }[];
      };
      profile_stats: {
        Args: { p_user_id: string };
        Returns: { posts: number; reels: number; likes_received: number }[];
      };
      post_view_counts: {
        Args: { p_target_type: string; p_target_ids: string[] };
        Returns: { target_id: string; views: number }[];
      };
      username_base: {
        Args: { p_seed: string };
        Returns: string;
      };
      is_conversation_member: {
        Args: { p_conversation_id: string; p_user_id: string };
        Returns: boolean;
      };
      get_or_create_direct_conversation: {
        Args: { p_other_user_id: string };
        Returns: string;
      };
      create_group_conversation: {
        Args: { p_name: string; p_member_ids: string[] };
        Returns: string;
      };
      add_group_members: {
        Args: { p_conversation_id: string; p_member_ids: string[] };
        Returns: undefined;
      };
      get_unread_counts: {
        Args: Record<PropertyKey, never>;
        Returns: { conversation_id: string; unread_count: number }[];
      };
      get_total_unread: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      mark_conversation_read: {
        Args: { p_conversation_id: string };
        Returns: undefined;
      };
      mark_conversations_read: {
        Args: { p_conversation_ids?: string[] | null };
        Returns: number;
      };
      apartments_within: {
        Args: { p_university_id: string; p_radius_m: number };
        Returns: Database["public"]["Tables"]["apartments"]["Row"][];
        SetofOptions: { from: "*"; to: "apartments"; isOneToOne: false; isSetofReturn: true };
      };
      roommate_posts_within: {
        Args: { p_university_id: string; p_radius_m: number };
        Returns: Database["public"]["Tables"]["roommate_posts"]["Row"][];
        SetofOptions: { from: "*"; to: "roommate_posts"; isOneToOne: false; isSetofReturn: true };
      };
      university_for_email: {
        Args: { p_email: string };
        Returns: string | null;
      };
      allowed_email_domains: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      mark_notifications_read: {
        Args: { p_ids?: string[] | null };
        Returns: number;
      };
      unread_notification_count: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      record_view: {
        Args: { p_target_type: string; p_target_id: string; p_viewer_key?: string | null };
        Returns: undefined;
      };
      record_contact: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: undefined;
      };
      listing_owner: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: string | null;
      };
      listing_stats: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: { views: number; saves: number; contacts: number }[];
      };
      is_blocked_either_way: {
        Args: { p_other: string };
        Returns: boolean;
      };
      delete_my_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      reels_feed: {
        Args: { p_university_id?: string | null; p_limit?: number; p_offset?: number };
        Returns: {
          source_type: string;
          source_id: string;
          author_id: string;
          author_name: string;
          author_avatar_url: string | null;
          author_verified: boolean;
          title: string | null;
          caption: string;
          video: Json;
          created_at: string;
          likes: number;
          comments: number;
          liked_by_me: boolean;
          saved_by_me: boolean;
        }[];
      };
      /** Migration 44 (Discover): posts and reels from every campus (or one), hottest first. */
      discover_feed: {
        Args: { p_university_id?: string | null; p_limit?: number; p_offset?: number };
        Returns: { post_id: string; kind: string }[];
      };
      /** Migration 44: accounts to follow, never the caller, someone they follow or block, or a business. */
      discover_accounts: {
        Args: { p_university_id?: string | null; p_limit?: number; p_offset?: number };
        Returns: { id: string; full_name: string; avatar_url: string | null; email_domain: string | null; university_name: string | null; followers: number }[];
      };
      discover_topics: {
        Args: { p_limit?: number };
        Returns: { tag: string; posts: number }[];
      };
      discover_search_topics: {
        Args: { p_q: string; p_limit?: number };
        Returns: { tag: string; posts: number }[];
      };
      discover_topic: {
        Args: { p_tag: string };
        Returns: { tag: string; posts: number }[];
      };
      discover_topic_posts: {
        Args: { p_tag: string; p_order?: string; p_limit?: number; p_offset?: number };
        Returns: { post_id: string; kind: string }[];
      };
      discover_search_posts: {
        Args: { p_q: string; p_limit?: number; p_offset?: number };
        Returns: { post_id: string; kind: string }[];
      };
      buzz_feed: {
        Args: { p_university_id?: string | null; p_topic?: string | null; p_sort?: string; p_limit?: number; p_offset?: number; p_q?: string | null };
        Returns: {
          id: string;
          topic: string;
          title: string;
          body: string;
          images: string[];
          image_meta: Json;
          videos: Json;
          university_id: string | null;
          score: number;
          comment_count: number;
          created_at: string;
          my_vote: number;
          is_mine: boolean;
          alias: string;
        }[];
      };
      buzz_get: {
        Args: { p_id: string };
        Returns: {
          id: string;
          topic: string;
          title: string;
          body: string;
          images: string[];
          image_meta: Json;
          videos: Json;
          university_id: string | null;
          score: number;
          comment_count: number;
          created_at: string;
          my_vote: number;
          is_mine: boolean;
          alias: string;
        }[];
      };
      buzz_comments_list: {
        Args: { p_post_id: string };
        Returns: { id: string; parent_id: string | null; body: string; created_at: string; alias: string; is_op: boolean; is_mine: boolean; score: number; my_vote: number }[];
      };
      buzz_create: {
        Args: { p_topic: string; p_title: string; p_body?: string; p_university_id?: string | null; p_images?: string[]; p_image_meta?: Json; p_videos?: Json };
        Returns: string;
      };
      buzz_reply: {
        Args: { p_post_id: string; p_body: string; p_parent_id?: string | null };
        Returns: string;
      };
      buzz_unmute: {
        Args: { p_post_id: string };
        Returns: undefined;
      };
      buzz_delete: {
        Args: { p_id: string };
        Returns: undefined;
      };
      buzz_comment_vote: {
        Args: { p_comment_id: string; p_value: number };
        Returns: { score: number; my_vote: number }[];
      };
      buzz_vote: {
        Args: { p_post_id: string; p_value: number };
        Returns: { score: number; my_vote: number }[];
      };
      buzz_delete_comment: {
        Args: { p_comment_id: string };
        Returns: undefined;
      };
      buzz_mute: {
        Args: { p_post_id?: string | null; p_comment_id?: string | null };
        Returns: undefined;
      };
      /** Installed old builds' heartbeat; since migration 22 the same as touch_activity. */
      touch_presence: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      /** Stamps my last-active time while I show my active status; true when I do. */
      touch_activity: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      /**
       * Last-active times (to the minute) of the people among the first 100 ids whom I may see, and whether each is
       * recent (within about two minutes); the time is null for someone who shares a chat with me but has not written to
       * me (answered only while recent). Signed in only.
       */
      activity_status: {
        Args: { p_user_ids: string[] };
        Returns: { user_id: string; last_active_at: string | null; recent: boolean }[];
      };
      /** Show or hide my activity status (the only way to show it again: a plain profile update cannot). */
      set_show_active_status: {
        Args: { p_show: boolean };
        Returns: undefined;
      };
      /** Ids of everyone blocked either way with me (both directions); signed in only. */
      blocked_either_way_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
      mark_delivered_all: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      post_engagement: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: { likes: number; comments: number; liked_by_me: boolean }[];
      };
      post_engagement_many: {
        Args: { p_target_type: string; p_target_ids: string[] };
        Returns: { target_id: string; likes: number; comments: number; liked_by_me: boolean }[];
      };
      post_link: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: string;
      };
      video_vs_photo_stats: {
        Args: { p_min?: number };
        Returns: {
          video_listings: number;
          photo_listings: number;
          video_contact_rate: number | null;
          photo_contact_rate: number | null;
          contact_multiplier: number | null;
        }[];
      };
      post_comment_vote: {
        Args: { p_comment_id: string; p_value: number };
        Returns: { score: number; likes: number; my_vote: number }[];
      };
      follow_stats: {
        Args: { p_user_ids: string[] };
        Returns: { user_id: string; followers: number; following: number; followed_by_me: boolean; follows_me: boolean }[];
      };
      list_friends: {
        Args: { p_q?: string | null };
        Returns: Database["public"]["Tables"]["profiles"]["Row"][];
      };
      mutual_friends: {
        Args: { p_user_id: string };
        Returns: Database["public"]["Tables"]["profiles"]["Row"][];
      };
      mutual_friend_ids: {
        Args: { p_user_id: string };
        Returns: string[];
      };
      following_posts: {
        Args: { p_kind?: string | null; p_university_id?: string | null };
        Returns: Database["public"]["Tables"]["feed_posts"]["Row"][];
      };
      search_messages: {
        Args: { p_q: string; p_conversation_id?: string | null; p_limit?: number };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      conversation_shared_messages: {
        Args: { p_conversation_id: string; p_kind: string; p_before?: string | null; p_limit?: number };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      list_snap_recipients: {
        Args: { p_q?: string | null };
        Returns: { id: string; full_name: string; avatar_url: string | null; is_friend: boolean; last_message_at: string | null }[];
      };
      /** Returns {snap_id, expires_at, sent: [{recipient_id, conversation_id, message_id}]}. */
      send_snap: {
        Args: { p_path: string; p_kind: string; p_mime: string; p_width: number | null; p_height: number | null; p_duration: number | null; p_recipient_ids: string[]; p_preview?: string | null };
        Returns: Json;
      };
      /** Returns {id, path, kind, mime, width, height, duration, sent_at, opened_at, view_until, conversation_id, message_id, sender: {id, full_name, avatar_url}}. */
      open_snap: {
        /** p_detect (migration 33): what the viewer's device can tell about captures, "ios", "android" or "none". */
        Args: { p_snap_id: string; p_detect?: string | null };
        Returns: Json;
      };
      close_snap: {
        Args: { p_snap_id: string };
        Returns: undefined;
      };
      /** Migration 35: starts a call in a chat (or joins the one going on there). Returns {call_id, message_id, conversation_id, joined}. */
      start_call: {
        Args: { p_conversation_id: string; p_kind: string };
        Returns: Json;
      };
      /** Migration 35: answers (or joins) a call that is not over. Returns the call as get_call does. */
      answer_call: {
        Args: { p_call_id: string };
        Returns: Json;
      };
      decline_call: {
        Args: { p_call_id: string };
        Returns: undefined;
      };
      leave_call: {
        Args: { p_call_id: string };
        Returns: undefined;
      };
      /** Migration 35: a call with everyone it rang, {…, participants: [{user_id, state, joined_at, left_at, profile}]}; null when out of reach. */
      get_call: {
        Args: { p_call_id: string };
        Returns: Json;
      };
      /** Migration 35: the call going on in a chat, as get_call gives it, or null. */
      current_call: {
        Args: { p_conversation_id: string };
        Returns: Json;
      };
      /** Migration 33: the chat on this device received the Snap ("Delivered" on its activity, once). */
      snap_delivered: {
        Args: { p_snap_id: string };
        Returns: undefined;
      };
      /** Migration 33: this device saw a "screenshot" or a "recording" while the Snap was open; its sender is told. */
      report_snap_capture: {
        Args: { p_snap_id: string; p_kind: string };
        Returns: undefined;
      };
      /** Migration 33: the sender takes a Snap back; every chat it went to shows "Snap deleted". */
      delete_snap: {
        Args: { p_snap_id: string };
        Returns: undefined;
      };
      /** Migration 39: the role of an account ('student' for an unknown id or signed out). */
      role_of: {
        Args: { p_user: string };
        Returns: string;
      };
      my_role: {
        Args: Record<string, never>;
        Returns: string;
      };
      /** Migration 39: a student's chat with the business behind a listing or deal; one per student and business. */
      start_business_inquiry: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: string;
      };
      business_invite_lookup: {
        Args: { p_token: string };
        Returns: { business_name: string; email: string; valid: boolean; role: string }[];
      };
      /** Migration 49: the role defaults to editor. */
      business_invite_create: {
        Args: { p_email: string; p_role?: string };
        Returns: Database["public"]["Tables"]["business_invites"]["Row"];
      };
      /** Migration 49: the owner or an admin changes a member's role (admin, editor or analyst). */
      business_member_set_role: {
        Args: { p_user: string; p_role: string };
        Returns: undefined;
      };
      /** Migration 49: may the caller do this (view, analytics, publish, reply, manage_team, edit_profile, manage_ads) now. */
      business_can: {
        Args: { p_business: string; p_capability: string };
        Returns: boolean;
      };
      /** Migration 49: the business audit log, newest first (the UniBuzz team: every business; owners and admins: their own). */
      business_audit: {
        Args: { p_business?: string | null; p_limit?: number; p_before?: number | null };
        Returns: {
          id: number;
          business_id: string | null;
          business_name: string | null;
          actor_id: string | null;
          actor_name: string;
          actor_kind: string;
          action: string;
          target_type: string | null;
          target_id: string | null;
          detail: Json;
          created_at: string;
        }[];
      };
      /** Migration 50: what still stops an ad from being submitted, in the portal's words. */
      ad_problems: {
        Args: { p_ad: string };
        Returns: string[];
      };
      ad_submit: { Args: { p_ad: string }; Returns: Database["public"]["Tables"]["ads"]["Row"] };
      ad_withdraw: { Args: { p_ad: string }; Returns: Database["public"]["Tables"]["ads"]["Row"] };
      ad_pause: { Args: { p_ad: string }; Returns: Database["public"]["Tables"]["ads"]["Row"] };
      ad_resume: { Args: { p_ad: string }; Returns: Database["public"]["Tables"]["ads"]["Row"] };
      ad_end: { Args: { p_ad: string }; Returns: Database["public"]["Tables"]["ads"]["Row"] };
      ad_duplicate: { Args: { p_ad: string }; Returns: string };
      admin_list_ads: {
        Args: { p_status?: string | null };
        Returns: {
          id: string;
          business_id: string;
          business_name: string;
          business_category: string;
          business_status: string;
          business_logo_url: string | null;
          name: string;
          objective: string;
          vertical: string;
          placements: string[];
          university_ids: string[];
          headline: string | null;
          caption: string;
          media: Json;
          cta: string;
          cta_url: string | null;
          promoted_deal_id: string | null;
          promoted_apartment_id: string | null;
          promoted_title: string | null;
          budget_cents: number;
          currency: string;
          starts_at: string | null;
          ends_at: string | null;
          status: string;
          paused_by: string | null;
          status_reason: string | null;
          review_note: string | null;
          needs_review_reason: string | null;
          fair_housing_flags: string[];
          submitted_at: string | null;
          reviewed_at: string | null;
          paid_cents: number;
          payment_reference: string | null;
          open_reports: number;
          created_at: string;
        }[];
      };
      admin_approve_ad: {
        Args: { p_ad: string; p_amount_cents: number; p_currency: string; p_payment_reference: string; p_note?: string | null; p_fair_housing_checked?: boolean };
        Returns: Database["public"]["Tables"]["ads"]["Row"];
      };
      admin_reject_ad: { Args: { p_ad: string; p_reason: string }; Returns: Database["public"]["Tables"]["ads"]["Row"] };
      admin_pause_ad: { Args: { p_ad: string; p_reason: string }; Returns: Database["public"]["Tables"]["ads"]["Row"] };
      admin_resume_ad: { Args: { p_ad: string }; Returns: Database["public"]["Tables"]["ads"]["Row"] };
      admin_list_business_reports: {
        Args: { p_status?: string | null };
        Returns: {
          id: string;
          business_id: string;
          business_name: string;
          ad_id: string | null;
          ad_name: string | null;
          deal_id: string | null;
          deal_title: string | null;
          reason: string;
          details: string | null;
          status: string;
          resolution_note: string | null;
          reporter_name: string | null;
          created_at: string;
          resolved_at: string | null;
        }[];
      };
      admin_resolve_business_report: { Args: { p_report: string; p_status: string; p_note?: string | null }; Returns: undefined };
      business_ad_stats: {
        Args: { p_business: string };
        Returns: {
          ad_id: string;
          name: string;
          status: string;
          placements: string[];
          starts_at: string | null;
          ends_at: string | null;
          budget_cents: number;
          currency: string;
          impressions: number;
          reach: number;
          clicks: number;
          saves: number;
          profile_visits: number;
          inquiries: number;
        }[];
      };
      business_daily_stats: {
        Args: { p_business: string; p_days?: number; p_ad?: string | null };
        Returns: { day: string; impressions: number; reach: number; clicks: number; saves: number; profile_visits: number; inquiries: number }[];
      };
      business_analytics_overview: {
        Args: { p_business: string; p_days?: number };
        Returns: {
          impressions: number;
          reach: number;
          clicks: number;
          saves: number;
          profile_visits: number;
          inquiries: number;
          post_views: number;
          active_ads: number;
          spend_cents: number;
        }[];
      };
      /** Migration 50: a signed-in student saw, tapped, saved or messaged a business's ad, post or listing, or opened its profile. */
      record_business_event: {
        Args: { p_event: string; p_business?: string | null; p_ad?: string | null; p_deal?: string | null; p_apartment?: string | null; p_placement?: string | null };
        Returns: undefined;
      };
      /** Migration 50: running, paid ads for one placement and the caller's campus (signed-in students only). */
      ads_for_feed: {
        Args: { p_placement: string; p_limit?: number; p_offset?: number };
        Returns: {
          id: string;
          business_id: string;
          business_name: string;
          business_logo_url: string | null;
          business_category: string;
          verified_partner: boolean;
          objective: string;
          headline: string | null;
          caption: string;
          media: Json;
          cta: string;
          cta_url: string | null;
          placement: string;
          ends_at: string;
          promoted: Json | null;
        }[];
      };
      my_saved_ads: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          business_id: string;
          business_name: string;
          business_logo_url: string | null;
          verified_partner: boolean;
          headline: string | null;
          caption: string;
          media: Json;
          cta: string;
          cta_url: string | null;
          promoted_deal_id: string | null;
          promoted_apartment_id: string | null;
          running: boolean;
          saved_at: string;
        }[];
      };
      hide_ad: { Args: { p_ad: string }; Returns: undefined };
      save_ad: { Args: { p_ad: string; p_saved?: boolean }; Returns: undefined };
      set_business_blocked: { Args: { p_business: string; p_blocked?: boolean }; Returns: undefined };
      business_blocked_by_me: { Args: { p_business: string }; Returns: boolean };
      report_business: {
        Args: { p_business: string | null; p_reason: string; p_details?: string | null; p_ad?: string | null; p_deal?: string | null };
        Returns: undefined;
      };
      /** Migration 50: the Fair Housing screen's hits ("Category: \"phrase\""), for the portal's preview. */
      fair_housing_flags: { Args: { p_text: string }; Returns: string[] };
      business_invite_revoke: {
        Args: { p_id: string };
        Returns: undefined;
      };
      business_member_remove: {
        Args: { p_user: string };
        Returns: undefined;
      };
      business_listing_stats: {
        Args: { p_business: string };
        Returns: {
          listing_id: string;
          title: string;
          status: string;
          created_at: string;
          views: number;
          views_7d: number;
          saves: number;
          contacts: number;
          inquiries: number;
          last_inquiry_at: string | null;
          /** When the paid promotion running now ends; null when the listing is not sponsored. */
          sponsored_until: string | null;
        }[];
      };
      business_deal_stats: {
        Args: { p_business: string };
        Returns: { deal_id: string; title: string; status: string; created_at: string; views: number; views_7d: number; inquiries: number; last_inquiry_at: string | null; sponsored_until: string | null }[];
      };
      /** Migration 39: the caller's business with every column (students cannot read some), and their place on its team. */
      my_business: {
        Args: Record<string, never>;
        Returns: Json;
      };
      admin_set_verified: {
        Args: { p_business: string; p_verified: boolean; p_evidence?: string | null };
        Returns: undefined;
      };
      admin_business_targets: {
        Args: { p_business: string };
        Returns: { target_type: string; target_id: string; title: string; status: string }[];
      };
      admin_record_promotion: {
        Args: { p_target_type: string; p_target_id: string; p_starts_at: string; p_ends_at: string; p_amount_cents: number; p_currency: string; p_payment_reference: string };
        Returns: string;
      };
      admin_cancel_promotion: {
        Args: { p_id: string };
        Returns: undefined;
      };
      admin_list_promotions: {
        Args: { p_business: string };
        Returns: {
          id: string;
          target_type: string;
          target_id: string;
          title: string | null;
          starts_at: string;
          ends_at: string;
          amount_cents: number;
          currency: string;
          payment_reference: string;
          status: string;
          created_at: string;
        }[];
      };
      business_overview: {
        Args: { p_business: string };
        Returns: { active_listings: number; active_deals: number; views_30d: number; inquiries: number; inquiries_30d: number; team: number }[];
      };
      admin_list_businesses: {
        Args: { p_status?: string | null };
        Returns: {
          id: string;
          name: string;
          category: string;
          description: string;
          website: string | null;
          phone: string | null;
          contact_email: string | null;
          address: string | null;
          city: string | null;
          logo_url: string | null;
          university_ids: string[];
          status: string;
          verified_partner: boolean;
          verified_at: string | null;
          verification_note: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          created_at: string;
          owner_id: string;
          owner_name: string;
          owner_email: string | null;
          owner_confirmed: boolean;
          members: number;
          listings: number;
          deals: number;
          active_promotions: number;
        }[];
      };
      admin_review_business: {
        Args: { p_business: string; p_decision: string; p_note?: string | null };
        Returns: undefined;
      };
      // CampConnect Admin's functions (step-admin's migrations 14 to 18, and the report auto-hide migration on auto-hide-reports).
      admin_audit_list: {
        Args: { p_limit?: number; p_before?: number | null };
        Returns: {
          id: number;
          actor_id: string | null;
          actor_email: string | null;
          actor_name: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          details: Json;
          created_at: string;
        }[];
      };
      admin_auto_hidden_counts: { Args: Record<string, never>; Returns: Json };
      admin_auto_hidden_list: {
        Args: { p_status?: string; p_limit?: number; p_before?: string | null; p_target_type?: string | null; p_target_id?: string | null };
        Returns: {
          id: string;
          target_type: string;
          target_id: string;
          source: string;
          reporter_count: number;
          reasons: Json;
          hidden_at: string;
          created_at: string;
          status: string;
          reviewed_by: string | null;
          reviewer_name: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          target_exists: boolean;
          target_hidden: boolean;
          title: string | null;
          preview: string | null;
          author_id: string | null;
          author_name: string | null;
        }[];
      };
      admin_auto_hide_uphold: { Args: { p_id: string; p_note?: string | null }; Returns: undefined };
      admin_bootstrap_owner: {
        Args: { p_email: string };
        Returns: string;
      };
      admin_content_delete: {
        Args: { p_target_type: string; p_target_id: string; p_reason: string };
        Returns: undefined;
      };
      admin_content_get: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: Json;
      };
      admin_content_hide: {
        Args: { p_target_type: string; p_target_id: string; p_reason: string };
        Returns: undefined;
      };
      admin_content_restore: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: undefined;
      };
      admin_hidden_content_list: {
        Args: { p_type?: string | null; p_limit?: number; p_before?: string | null };
        Returns: {
          target_type: string;
          target_id: string;
          hidden_at: string;
          hidden_reason: string | null;
          title: string | null;
          preview: string | null;
          author_id: string | null;
          author_name: string | null;
          created_at: string;
        }[];
      };
      admin_invite_email_result: {
        Args: { p_email: string; p_ok: boolean; p_user_id?: string | null; p_error?: string | null };
        Returns: undefined;
      };
      admin_invite_resend: {
        Args: { p_email: string };
        Returns: string;
      };
      admin_invite_revoke: {
        Args: { p_email: string };
        Returns: boolean;
      };
      admin_invites_list: {
        Args: Record<PropertyKey, never>;
        Returns: {
          email: string;
          role: string;
          invited_by: string | null;
          invited_by_name: string | null;
          created_at: string;
          expires_at: string | null;
          expired: boolean;
          email_status: string;
          email_sent_at: string | null;
          email_attempts: number;
          email_error: string | null;
          account_created: boolean;
        }[];
      };
      admin_me: {
        Args: Record<PropertyKey, never>;
        Returns: { user_id: string; role: string; mfa_verified: boolean; mfa_enrolled: boolean; last_owner: boolean }[];
      };
      admin_media_jobs_list: {
        Args: { p_pending_only?: boolean; p_limit?: number };
        Returns: {
          id: number;
          kind: string;
          ref: string;
          target_type: string | null;
          target_id: string | null;
          attempts: number;
          last_error: string | null;
          next_attempt_at: string;
          claimed_at: string | null;
          created_at: string;
          done_at: string | null;
        }[];
      };
      admin_media_jobs_retry: {
        Args: { p_id: number };
        Returns: undefined;
      };
      admin_media_jobs_stats: {
        Args: Record<PropertyKey, never>;
        Returns: { pending: number; failing: number; done: number }[];
      };
      admin_overview_stats: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      admin_report_get: {
        Args: { p_id: string };
        Returns: {
          id: string;
          reporter_id: string;
          reporter_name: string | null;
          reporter_email: string | null;
          target_type: string;
          target_id: string;
          reason: string;
          details: string | null;
          status: string;
          decision: string | null;
          notes: string | null;
          reviewed_by: string | null;
          reviewer_name: string | null;
          reviewed_at: string | null;
          created_at: string;
          target_preview: string;
          target_hidden: boolean;
          target_exists: boolean;
          target_author_id: string | null;
        }[];
      };
      admin_report_reopen: {
        Args: { p_id: string };
        Returns: undefined;
      };
      admin_report_resolve: {
        Args: { p_id: string; p_decision: string; p_notes?: string | null };
        Returns: undefined;
      };
      admin_reports_list: {
        Args: { p_status?: string; p_limit?: number; p_before?: string | null };
        Returns: {
          id: string;
          reporter_id: string;
          reporter_name: string | null;
          reporter_email: string | null;
          target_type: string;
          target_id: string;
          reason: string;
          details: string | null;
          status: string;
          decision: string | null;
          notes: string | null;
          reviewed_by: string | null;
          reviewer_name: string | null;
          reviewed_at: string | null;
          created_at: string;
          target_preview: string;
          target_hidden: boolean;
          target_exists: boolean;
          target_author_id: string | null;
        }[];
      };
      admin_restrictions_list: {
        Args: { p_active_only?: boolean; p_limit?: number };
        Returns: {
          id: string;
          user_id: string;
          full_name: string;
          email: string | null;
          kind: string;
          reason: string;
          internal_note: string | null;
          expires_at: string | null;
          created_by: string | null;
          created_by_name: string | null;
          created_at: string;
          lifted_at: string | null;
          lifted_by_name: string | null;
          lift_note: string | null;
          active: boolean;
        }[];
      };
      admin_staff_add: {
        Args: { p_email: string; p_role: string };
        Returns: string;
      };
      admin_staff_list: {
        Args: Record<PropertyKey, never>;
        Returns: {
          user_id: string;
          email: string | null;
          full_name: string;
          avatar_url: string | null;
          role: string;
          granted_by: string | null;
          granted_by_name: string | null;
          created_at: string;
          mfa_enrolled: boolean | null;
        }[];
      };
      admin_staff_remove: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      admin_staff_set_role: {
        Args: { p_user_id: string; p_role: string };
        Returns: undefined;
      };
      admin_user_get: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      admin_user_search: {
        Args: { p_q: string; p_limit?: number };
        Returns: {
          user_id: string;
          full_name: string;
          email: string | null;
          avatar_url: string | null;
          university_name: string | null;
          created_at: string;
          suspended: boolean;
          staff_role: string | null;
        }[];
      };
      admin_user_suspend: {
        Args: { p_user_id: string; p_reason: string; p_expires_at?: string | null; p_note?: string | null };
        Returns: string;
      };
      admin_user_unsuspend: {
        Args: { p_user_id: string; p_note?: string | null };
        Returns: undefined;
      };
      admin_users_list: {
        Args: { p_filter?: string; p_limit?: number; p_before?: string | null };
        Returns: {
          user_id: string;
          full_name: string;
          email: string | null;
          avatar_url: string | null;
          university_name: string | null;
          created_at: string;
          last_seen_at: string | null;
          suspended: boolean;
          staff_role: string | null;
        }[];
      };
      content_visible: {
        Args: { p_author: string | null; p_hidden_at: string | null };
        Returns: boolean;
      };
      is_suspended: {
        Args: { p_user: string | null };
        Returns: boolean;
      };
      media_jobs_claim: {
        Args: { p_limit?: number };
        Returns: Database["public"]["Tables"]["media_jobs"]["Row"][];
        SetofOptions: { from: "*"; to: "media_jobs"; isOneToOne: false; isSetofReturn: true };
      };
      media_jobs_done: {
        Args: { p_id: number };
        Returns: undefined;
      };
      media_jobs_failed: {
        Args: { p_id: number; p_error: string };
        Returns: undefined;
      };
      my_restriction: {
        Args: Record<PropertyKey, never>;
        Returns: { kind: string; reason: string; expires_at: string | null; created_at: string }[];
      };
    };
    Enums: {
      listing_status: "active" | "rented" | "archived";
      item_condition: "new" | "like_new" | "good" | "fair" | "poor";
      item_status: "available" | "sold" | "archived";
      roommate_post_type: "has_room" | "needs_room";
      conversation_type: "direct" | "group";
      gender_pref: "any" | "male" | "female" | "nonbinary";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
