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
          last_seen_at: string | null;
          show_active_status: boolean;
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
          hidden_at: string | null;
          hidden_reason: string | null;
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
          hidden_at?: string | null;
          hidden_reason?: string | null;
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
          hidden_at?: string | null;
          hidden_reason?: string | null;
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
        ];
      };
      roommate_posts: {
        Row: {
          id: string;
          author_id: string;
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
          hidden_at: string | null;
          hidden_reason: string | null;
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
          hidden_at?: string | null;
          hidden_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          author_id?: string;
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
          hidden_at?: string | null;
          hidden_reason?: string | null;
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
          seller_id: string;
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
          hidden_at: string | null;
          hidden_reason: string | null;
          created_at: string;
          updated_at: string;
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
          status?: Database["public"]["Enums"]["item_status"];
          hidden_at?: string | null;
          hidden_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
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
          status?: Database["public"]["Enums"]["item_status"];
          hidden_at?: string | null;
          hidden_reason?: string | null;
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
          hidden_at: string | null;
          hidden_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id?: string | null;
          content: string;
          image_url?: string | null;
          hidden_at?: string | null;
          hidden_reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string | null;
          content?: string;
          image_url?: string | null;
          hidden_at?: string | null;
          hidden_reason?: string | null;
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
          hidden_at: string | null;
          hidden_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          target_type: string;
          target_id: string;
          user_id: string;
          body: string;
          hidden_at?: string | null;
          hidden_reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          target_type?: string;
          target_id?: string;
          user_id?: string;
          body?: string;
          hidden_at?: string | null;
          hidden_reason?: string | null;
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
          hidden_at: string | null;
          hidden_reason: string | null;
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
          hidden_at?: string | null;
          hidden_reason?: string | null;
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
          hidden_at?: string | null;
          hidden_reason?: string | null;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
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
      touch_presence: {
        Args: Record<string, never>;
        Returns: undefined;
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
      admin_me: {
        Args: Record<PropertyKey, never>;
        Returns: { user_id: string; role: string; mfa_verified: boolean; mfa_enrolled: boolean; last_owner: boolean }[];
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
      admin_staff_add: {
        Args: { p_email: string; p_role: string };
        Returns: string;
      };
      admin_staff_set_role: {
        Args: { p_user_id: string; p_role: string };
        Returns: undefined;
      };
      admin_staff_remove: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      admin_invite_revoke: {
        Args: { p_email: string };
        Returns: boolean;
      };
      // Migration 18: invitations sent by email
      admin_invite_email_result: {
        Args: { p_email: string; p_ok: boolean; p_user_id?: string | null; p_error?: string | null };
        Returns: undefined;
      };
      admin_invite_resend: {
        Args: { p_email: string };
        Returns: string;
      };
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
      admin_bootstrap_owner: {
        Args: { p_email: string };
        Returns: string;
      };
      is_suspended: {
        Args: { p_user: string | null };
        Returns: boolean;
      };
      content_visible: {
        Args: { p_author: string | null; p_hidden_at: string | null };
        Returns: boolean;
      };
      my_restriction: {
        Args: Record<PropertyKey, never>;
        Returns: { kind: string; reason: string; expires_at: string | null; created_at: string }[];
      };
      admin_user_suspend: {
        Args: { p_user_id: string; p_reason: string; p_expires_at?: string | null; p_note?: string | null };
        Returns: string;
      };
      admin_user_unsuspend: {
        Args: { p_user_id: string; p_note?: string | null };
        Returns: undefined;
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
      admin_user_get: {
        Args: { p_user_id: string };
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
      admin_content_delete: {
        Args: { p_target_type: string; p_target_id: string; p_reason: string };
        Returns: undefined;
      };
      admin_content_get: {
        Args: { p_target_type: string; p_target_id: string };
        Returns: Json;
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
      admin_report_resolve: {
        Args: { p_id: string; p_decision: string; p_notes?: string | null };
        Returns: undefined;
      };
      admin_report_reopen: {
        Args: { p_id: string };
        Returns: undefined;
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
      // Migration 16: read-only dashboard queries for the admin app
      admin_overview_stats: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
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
