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
      adjustments: {
        Row: {
          adjustment_id: string
          applied_to_ledger: string | null
          approved_value: number | null
          asset_description: string | null
          booking_id: string | null
          client_name: string | null
          client_ref: string | null
          company_loss_gain: number | null
          created_at: string
          loss_gain_type: string | null
          note: string | null
          realized_value: number | null
          risk_check: string | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          adjustment_id: string
          applied_to_ledger?: string | null
          approved_value?: number | null
          asset_description?: string | null
          booking_id?: string | null
          client_name?: string | null
          client_ref?: string | null
          company_loss_gain?: number | null
          created_at?: string
          loss_gain_type?: string | null
          note?: string | null
          realized_value?: number | null
          risk_check?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          adjustment_id?: string
          applied_to_ledger?: string | null
          approved_value?: number | null
          asset_description?: string | null
          booking_id?: string | null
          client_name?: string | null
          client_ref?: string | null
          company_loss_gain?: number | null
          created_at?: string
          loss_gain_type?: string | null
          note?: string | null
          realized_value?: number | null
          risk_check?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "adjustments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      booking_documents: {
        Row: {
          booking_id: string
          created_at: string
          document_date: string
          file_name: string | null
          id: string
          label: string
          label_custom: string | null
          mime_type: string | null
          notes: string | null
          size_bytes: number | null
          source: string
          storage_path: string | null
          tcs_tracking_no: string | null
          updated_at: string
          uploaded_by: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          document_date?: string
          file_name?: string | null
          id?: string
          label: string
          label_custom?: string | null
          mime_type?: string | null
          notes?: string | null
          size_bytes?: number | null
          source?: string
          storage_path?: string | null
          tcs_tracking_no?: string | null
          updated_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          document_date?: string
          file_name?: string | null
          id?: string
          label?: string
          label_custom?: string | null
          mime_type?: string | null
          notes?: string | null
          size_bytes?: number | null
          source?: string
          storage_path?: string | null
          tcs_tracking_no?: string | null
          updated_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      bookings: {
        Row: {
          address: string | null
          adjustment_credit: number | null
          base_rate: number | null
          booking_date: string | null
          booking_id: string
          booking_status: string | null
          cash_received: number | null
          client_name: string | null
          client_ref: string | null
          cnic: string | null
          created_at: string
          current_overdue_count: number | null
          dealer_commission_amount: number | null
          dealer_commission_fixed: number | null
          dealer_commission_pct: number | null
          dealer_name: string | null
          down_payment: number | null
          first_installment_due: string | null
          floor: string | null
          installment_amount: number | null
          installment_frequency: string | null
          latest_overdue_date: string | null
          mobile: string | null
          net_company_value: number | null
          next_action: string | null
          no_of_installments: number | null
          notes: string | null
          oldest_overdue_date: string | null
          possession_amount: number | null
          possession_due_date: string | null
          price_loss: number | null
          project_code: string | null
          project_name: string | null
          remaining_balance: number | null
          risk_level: string | null
          size_sqft: number | null
          so_wo: string | null
          sold_rate: number | null
          sold_total_override: number | null
          sold_unit_value: number | null
          standard_value: number | null
          total_contract_value: number | null
          total_overdue_amount: number | null
          unit_id: string | null
          unit_type: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          adjustment_credit?: number | null
          base_rate?: number | null
          booking_date?: string | null
          booking_id: string
          booking_status?: string | null
          cash_received?: number | null
          client_name?: string | null
          client_ref?: string | null
          cnic?: string | null
          created_at?: string
          current_overdue_count?: number | null
          dealer_commission_amount?: number | null
          dealer_commission_fixed?: number | null
          dealer_commission_pct?: number | null
          dealer_name?: string | null
          down_payment?: number | null
          first_installment_due?: string | null
          floor?: string | null
          installment_amount?: number | null
          installment_frequency?: string | null
          latest_overdue_date?: string | null
          mobile?: string | null
          net_company_value?: number | null
          next_action?: string | null
          no_of_installments?: number | null
          notes?: string | null
          oldest_overdue_date?: string | null
          possession_amount?: number | null
          possession_due_date?: string | null
          price_loss?: number | null
          project_code?: string | null
          project_name?: string | null
          remaining_balance?: number | null
          risk_level?: string | null
          size_sqft?: number | null
          so_wo?: string | null
          sold_rate?: number | null
          sold_total_override?: number | null
          sold_unit_value?: number | null
          standard_value?: number | null
          total_contract_value?: number | null
          total_overdue_amount?: number | null
          unit_id?: string | null
          unit_type?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          adjustment_credit?: number | null
          base_rate?: number | null
          booking_date?: string | null
          booking_id?: string
          booking_status?: string | null
          cash_received?: number | null
          client_name?: string | null
          client_ref?: string | null
          cnic?: string | null
          created_at?: string
          current_overdue_count?: number | null
          dealer_commission_amount?: number | null
          dealer_commission_fixed?: number | null
          dealer_commission_pct?: number | null
          dealer_name?: string | null
          down_payment?: number | null
          first_installment_due?: string | null
          floor?: string | null
          installment_amount?: number | null
          installment_frequency?: string | null
          latest_overdue_date?: string | null
          mobile?: string | null
          net_company_value?: number | null
          next_action?: string | null
          no_of_installments?: number | null
          notes?: string | null
          oldest_overdue_date?: string | null
          possession_amount?: number | null
          possession_due_date?: string | null
          price_loss?: number | null
          project_code?: string | null
          project_name?: string | null
          remaining_balance?: number | null
          risk_level?: string | null
          size_sqft?: number | null
          so_wo?: string | null
          sold_rate?: number | null
          sold_total_override?: number | null
          sold_unit_value?: number | null
          standard_value?: number | null
          total_contract_value?: number | null
          total_overdue_amount?: number | null
          unit_id?: string | null
          unit_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_client_ref_fkey"
            columns: ["client_ref"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_ref"]
          },
          {
            foreignKeyName: "bookings_project_code_fkey"
            columns: ["project_code"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["project_code"]
          },
          {
            foreignKeyName: "bookings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["unit_id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          client_ref: string
          cnic: string | null
          created_at: string
          mobile: string | null
          name: string
          so_wo: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          client_ref: string
          cnic?: string | null
          created_at?: string
          mobile?: string | null
          name: string
          so_wo?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          client_ref?: string
          cnic?: string | null
          created_at?: string
          mobile?: string | null
          name?: string
          so_wo?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dealers: {
        Row: {
          created_at: string
          name: string
        }
        Insert: {
          created_at?: string
          name: string
        }
        Update: {
          created_at?: string
          name?: string
        }
        Relationships: []
      }
      installment_ledger: {
        Row: {
          aging_level: string | null
          booking_id: string
          client_name: string | null
          created_at: string
          days_overdue: number | null
          due_amount: number | null
          due_date: string | null
          ledger_id: string
          next_action: string | null
          paid_amount: number | null
          paid_date: string | null
          particulars: string | null
          project: string | null
          running_balance: number | null
          status: string | null
          term_no: number | null
          unit_no: string | null
          updated_at: string
        }
        Insert: {
          aging_level?: string | null
          booking_id: string
          client_name?: string | null
          created_at?: string
          days_overdue?: number | null
          due_amount?: number | null
          due_date?: string | null
          ledger_id: string
          next_action?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          particulars?: string | null
          project?: string | null
          running_balance?: number | null
          status?: string | null
          term_no?: number | null
          unit_no?: string | null
          updated_at?: string
        }
        Update: {
          aging_level?: string | null
          booking_id?: string
          client_name?: string | null
          created_at?: string
          days_overdue?: number | null
          due_amount?: number | null
          due_date?: string | null
          ledger_id?: string
          next_action?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          particulars?: string | null
          project?: string | null
          running_balance?: number | null
          status?: string | null
          term_no?: number | null
          unit_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_ledger_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      notices: {
        Row: {
          body: Json | null
          booking_id: string
          channel: string[]
          client_title: string | null
          created_at: string
          created_by: string | null
          deadline_date: string | null
          doc_type: string
          id: string
          notice_date: string
          overdue_amount: number | null
          overdue_count: number | null
          previous_notice_2_date: string | null
          previous_notice_date: string | null
          ref_no: string
          serial: number
          status: string
          unit_no: string | null
          updated_at: string
          year: number
        }
        Insert: {
          body?: Json | null
          booking_id: string
          channel?: string[]
          client_title?: string | null
          created_at?: string
          created_by?: string | null
          deadline_date?: string | null
          doc_type: string
          id?: string
          notice_date?: string
          overdue_amount?: number | null
          overdue_count?: number | null
          previous_notice_2_date?: string | null
          previous_notice_date?: string | null
          ref_no: string
          serial: number
          status?: string
          unit_no?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          body?: Json | null
          booking_id?: string
          channel?: string[]
          client_title?: string | null
          created_at?: string
          created_by?: string | null
          deadline_date?: string | null
          doc_type?: string
          id?: string
          notice_date?: string
          overdue_amount?: number | null
          overdue_count?: number | null
          previous_notice_2_date?: string | null
          previous_notice_date?: string | null
          ref_no?: string
          serial?: number
          status?: string
          unit_no?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "notices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      payments: {
        Row: {
          account: string | null
          amount: number
          booking_id: string | null
          cash_bank_include: boolean | null
          cheque_txn_no: string | null
          client_name: string | null
          cnic: string | null
          created_at: string
          memo: string | null
          non_cash_adjustment: boolean | null
          payment_date: string | null
          payment_head: string | null
          payment_mode: string | null
          posted_by: string | null
          project: string | null
          receipt_no: string
          received_from: string | null
          remarks: string | null
          safe_cash_amount: number | null
          status: string | null
          unit_no: string | null
          updated_at: string
        }
        Insert: {
          account?: string | null
          amount: number
          booking_id?: string | null
          cash_bank_include?: boolean | null
          cheque_txn_no?: string | null
          client_name?: string | null
          cnic?: string | null
          created_at?: string
          memo?: string | null
          non_cash_adjustment?: boolean | null
          payment_date?: string | null
          payment_head?: string | null
          payment_mode?: string | null
          posted_by?: string | null
          project?: string | null
          receipt_no: string
          received_from?: string | null
          remarks?: string | null
          safe_cash_amount?: number | null
          status?: string | null
          unit_no?: string | null
          updated_at?: string
        }
        Update: {
          account?: string | null
          amount?: number
          booking_id?: string | null
          cash_bank_include?: boolean | null
          cheque_txn_no?: string | null
          client_name?: string | null
          cnic?: string | null
          created_at?: string
          memo?: string | null
          non_cash_adjustment?: boolean | null
          payment_date?: string | null
          payment_head?: string | null
          payment_mode?: string | null
          posted_by?: string | null
          project?: string | null
          receipt_no?: string
          received_from?: string | null
          remarks?: string | null
          safe_cash_amount?: number | null
          status?: string | null
          unit_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          expected_completion_date: string | null
          location: string | null
          notes: string | null
          project_code: string
          project_name: string
          start_date: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          expected_completion_date?: string | null
          location?: string | null
          notes?: string | null
          project_code: string
          project_name: string
          start_date?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          expected_completion_date?: string | null
          location?: string | null
          notes?: string | null
          project_code?: string
          project_name?: string
          start_date?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      units: {
        Row: {
          base_rate: number | null
          booked_by: string | null
          created_at: string
          floor: string | null
          linked_booking_id: string | null
          notes: string | null
          project_code: string
          project_name: string | null
          size_sqft: number | null
          standard_value: number | null
          status: string | null
          unit_id: string
          unit_no: string | null
          unit_type: string | null
          updated_at: string
        }
        Insert: {
          base_rate?: number | null
          booked_by?: string | null
          created_at?: string
          floor?: string | null
          linked_booking_id?: string | null
          notes?: string | null
          project_code: string
          project_name?: string | null
          size_sqft?: number | null
          standard_value?: number | null
          status?: string | null
          unit_id: string
          unit_no?: string | null
          unit_type?: string | null
          updated_at?: string
        }
        Update: {
          base_rate?: number | null
          booked_by?: string | null
          created_at?: string
          floor?: string | null
          linked_booking_id?: string | null
          notes?: string | null
          project_code?: string
          project_name?: string | null
          size_sqft?: number | null
          standard_value?: number | null
          status?: string | null
          unit_id?: string
          unit_no?: string | null
          unit_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_project_code_fkey"
            columns: ["project_code"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["project_code"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_writer: { Args: { _uid: string }; Returns: boolean }
      next_notice_serial: {
        Args: { _booking_id: string; _year: number }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "staff" | "viewer"
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
    Enums: {
      app_role: ["admin", "manager", "staff", "viewer"],
    },
  },
} as const
