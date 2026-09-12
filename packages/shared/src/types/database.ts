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
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id?: string | null;
          content: string;
          image_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string | null;
          content?: string;
          image_url?: string | null;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          target_type: string;
          target_id: string;
          user_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          target_type?: string;
          target_id?: string;
          user_id?: string;
          body?: string;
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
