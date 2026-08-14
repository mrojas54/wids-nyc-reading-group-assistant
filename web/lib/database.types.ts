// Supabase schema types — GENERATED FILE, do not edit by hand.
//
// Regenerate after any migration with:
//   supabase gen types typescript --project-id dmyulakudbdegwkqgelx > web/lib/database.types.ts
// (or via the Supabase MCP `generate_typescript_types`).
//
// Consumed by the typed client factories in web/lib/supabase/*.ts.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      availability: {
        Row: {
          created_at: string
          id: number
          meeting_id: number
          member_id: number
          range_end: string
          range_start: string
        }
        Insert: {
          created_at?: string
          id?: number
          meeting_id: number
          member_id: number
          range_end: string
          range_start: string
        }
        Update: {
          created_at?: string
          id?: number
          meeting_id?: number
          member_id?: number
          range_end?: string
          range_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      blackout_periods: {
        Row: {
          created_at: string
          id: number
          range_end: string
          range_start: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          range_end: string
          range_start: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          range_end?: string
          range_start?: string
          reason?: string | null
        }
        Relationships: []
      }
      command_log: {
        Row: {
          actor: string | null
          duration_ms: number | null
          error: string | null
          id: number
          idempotency_key: string | null
          metadata: Json
          name: string
          ran_at: string
          source: string
          status: string
          summary: string | null
        }
        Insert: {
          actor?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: number
          idempotency_key?: string | null
          metadata?: Json
          name: string
          ran_at?: string
          source: string
          status: string
          summary?: string | null
        }
        Update: {
          actor?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: number
          idempotency_key?: string | null
          metadata?: Json
          name?: string
          ran_at?: string
          source?: string
          status?: string
          summary?: string | null
        }
        Relationships: []
      }
      meeting_attendance: {
        Row: {
          id: number
          meeting_id: number
          member_id: number
          notes: string | null
          responded_at: string | null
          rsvp_status: string
        }
        Insert: {
          id?: number
          meeting_id: number
          member_id: number
          notes?: string | null
          responded_at?: string | null
          rsvp_status?: string
        }
        Update: {
          id?: number
          meeting_id?: number
          member_id?: number
          notes?: string | null
          responded_at?: string | null
          rsvp_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_attendance_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          calendar_event_id: string | null
          calendar_html_link: string | null
          created_at: string
          drive_folder_url: string | null
          form_url: string | null
          id: number
          leader_id: number | null
          location: string | null
          paper_id: number | null
          planned_by_admin_id: number | null
          scheduled_at: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          calendar_event_id?: string | null
          calendar_html_link?: string | null
          created_at?: string
          drive_folder_url?: string | null
          form_url?: string | null
          id?: number
          leader_id?: number | null
          location?: string | null
          paper_id?: number | null
          planned_by_admin_id?: number | null
          scheduled_at?: string | null
          status: string
          type: string
          updated_at?: string
        }
        Update: {
          calendar_event_id?: string | null
          calendar_html_link?: string | null
          created_at?: string
          drive_folder_url?: string | null
          form_url?: string | null
          id?: number
          leader_id?: number | null
          location?: string | null
          paper_id?: number | null
          planned_by_admin_id?: number | null
          scheduled_at?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_planned_by_admin_id_fkey"
            columns: ["planned_by_admin_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          active: boolean
          auth_user_id: string | null
          email: string
          id: number
          joined_at: string
          name: string
          phone: string | null
          role: string
          vouched_by: number | null
          whatsapp: string | null
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          email: string
          id?: number
          joined_at?: string
          name: string
          phone?: string | null
          role?: string
          vouched_by?: number | null
          whatsapp?: string | null
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          email?: string
          id?: number
          joined_at?: string
          name?: string
          phone?: string | null
          role?: string
          vouched_by?: number | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_vouched_by_fkey"
            columns: ["vouched_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_companions: {
        Row: {
          generated_at: string
          generated_by: number | null
          last_synthesis_at: string | null
          model: string
          paper_id: number
          payload: Json
          provider: string
          regeneration_count: number
        }
        Insert: {
          generated_at?: string
          generated_by?: number | null
          last_synthesis_at?: string | null
          model: string
          paper_id: number
          payload: Json
          provider?: string
          regeneration_count?: number
        }
        Update: {
          generated_at?: string
          generated_by?: number | null
          last_synthesis_at?: string | null
          model?: string
          paper_id?: number
          payload?: Json
          provider?: string
          regeneration_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_companions_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_companions_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: true
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_embeddings: {
        Row: {
          cached_at: string
          model: string
          paper_id: number
          vector: string
        }
        Insert: {
          cached_at?: string
          model: string
          paper_id: number
          vector: string
        }
        Update: {
          cached_at?: string
          model?: string
          paper_id?: number
          vector?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_embeddings_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_socratic_turns: {
        Row: {
          ai_next_question: string | null
          ai_summary: string | null
          created_at: string
          id: number
          member_id: number
          model: string | null
          paper_id: number
          prompt_id: string
          provider: string
          turn_number: number
          user_response: string
        }
        Insert: {
          ai_next_question?: string | null
          ai_summary?: string | null
          created_at?: string
          id?: number
          member_id: number
          model?: string | null
          paper_id: number
          prompt_id: string
          provider: string
          turn_number: number
          user_response: string
        }
        Update: {
          ai_next_question?: string | null
          ai_summary?: string | null
          created_at?: string
          id?: number
          member_id?: number
          model?: string | null
          paper_id?: number
          prompt_id?: string
          provider?: string
          turn_number?: number
          user_response?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_socratic_turns_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_socratic_turns_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_suggestions: {
        Row: {
          id: number
          meeting_id: number
          notes: string | null
          paper_id: number
          source: string
          suggested_at: string
          suggested_by: number | null
        }
        Insert: {
          id?: number
          meeting_id: number
          notes?: string | null
          paper_id: number
          source: string
          suggested_at?: string
          suggested_by?: number | null
        }
        Update: {
          id?: number
          meeting_id?: number
          notes?: string | null
          paper_id?: number
          source?: string
          suggested_at?: string
          suggested_by?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_suggestions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_suggestions_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_suggestions_suggested_by_fkey"
            columns: ["suggested_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_topics: {
        Row: {
          paper_id: number
          topic_id: number
        }
        Insert: {
          paper_id: number
          topic_id: number
        }
        Update: {
          paper_id?: number
          topic_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_topics_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      papers: {
        Row: {
          abstract: string | null
          added_at: string
          authors: string[] | null
          companion_url: string | null
          id: number
          pdf_drive_url: string | null
          prerequisites: Json | null
          s2_paper_id: string | null
          title: string
          url: string | null
          venue: string | null
          year: number | null
          zotero_item_key: string | null
        }
        Insert: {
          abstract?: string | null
          added_at?: string
          authors?: string[] | null
          companion_url?: string | null
          id?: number
          pdf_drive_url?: string | null
          prerequisites?: Json | null
          s2_paper_id?: string | null
          title: string
          url?: string | null
          venue?: string | null
          year?: number | null
          zotero_item_key?: string | null
        }
        Update: {
          abstract?: string | null
          added_at?: string
          authors?: string[] | null
          companion_url?: string | null
          id?: number
          pdf_drive_url?: string | null
          prerequisites?: Json | null
          s2_paper_id?: string | null
          title?: string
          url?: string | null
          venue?: string | null
          year?: number | null
          zotero_item_key?: string | null
        }
        Relationships: []
      }
      topics: {
        Row: {
          id: number
          name: string
          weight: number
        }
        Insert: {
          id?: number
          name: string
          weight?: number
        }
        Update: {
          id?: number
          name?: string
          weight?: number
        }
        Relationships: []
      }
      volunteers: {
        Row: {
          id: number
          meeting_id: number
          member_id: number
          submitted_at: string
        }
        Insert: {
          id?: number
          meeting_id: number
          member_id: number
          submitted_at?: string
        }
        Update: {
          id?: number
          meeting_id?: number
          member_id?: number
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteers_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteers_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_synthesize_paper_pal: { Args: { p_paper_id: number }; Returns: Json }
      current_member_id: { Args: never; Returns: number }
      current_member_role: { Args: never; Returns: string }
      upsert_paper_companion: {
        Args: {
          p_generated_by: number
          p_model: string
          p_paper_id: number
          p_payload: Json
          p_provider: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
