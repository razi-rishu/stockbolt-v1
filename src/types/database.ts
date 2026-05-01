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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          company_id: string
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          uploaded_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          company_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          new_data: Json | null
          old_data: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number: string | null
          account_type: string
          bank_name: string | null
          branch: string | null
          coa_account_id: string
          company_id: string
          created_at: string
          currency: string
          iban: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          name_ar: string | null
          opening_balance: number
          opening_balance_date: string | null
          swift_code: string | null
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          account_type: string
          bank_name?: string | null
          branch?: string | null
          coa_account_id: string
          company_id: string
          created_at?: string
          currency: string
          iban?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          name_ar?: string | null
          opening_balance?: number
          opening_balance_date?: string | null
          swift_code?: string | null
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          account_type?: string
          bank_name?: string | null
          branch?: string | null
          coa_account_id?: string
          company_id?: string
          created_at?: string
          currency?: string
          iban?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          name_ar?: string | null
          opening_balance?: number
          opening_balance_date?: string | null
          swift_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_coa_account_id_fkey"
            columns: ["coa_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transfers: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          date: string
          from_account_id: string
          id: string
          notes: string | null
          reference: string | null
          status: string
          to_account_id: string
          transfer_number: string
          updated_at: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          date: string
          from_account_id: string
          id?: string
          notes?: string | null
          reference?: string | null
          status?: string
          to_account_id: string
          transfer_number: string
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          date?: string
          from_account_id?: string
          id?: string
          notes?: string | null
          reference?: string | null
          status?: string
          to_account_id?: string
          transfer_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          name_ar: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          name_ar?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          name_ar?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_ar: string | null
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_ar?: string | null
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_ar?: string | null
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          name_ar: string | null
          parent_id: string | null
          sub_type: string | null
          type: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          name_ar?: string | null
          parent_id?: string | null
          sub_type?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          name_ar?: string | null
          parent_id?: string | null
          sub_type?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          address_ar: string | null
          allow_future_dating: boolean
          base_currency: string
          city: string | null
          cogs_deferral_enabled: boolean
          costing_method: string
          country_code: string
          created_at: string
          currency: string
          email: string | null
          fiscal_year_start: string
          id: string
          is_tax_registered: boolean
          logo_url: string | null
          name: string
          name_ar: string | null
          period_lock_date: string | null
          phone: string | null
          prices_inclusive_of_tax: boolean
          state: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          address_ar?: string | null
          allow_future_dating?: boolean
          base_currency: string
          city?: string | null
          cogs_deferral_enabled?: boolean
          costing_method?: string
          country_code: string
          created_at?: string
          currency: string
          email?: string | null
          fiscal_year_start?: string
          id?: string
          is_tax_registered?: boolean
          logo_url?: string | null
          name: string
          name_ar?: string | null
          period_lock_date?: string | null
          phone?: string | null
          prices_inclusive_of_tax?: boolean
          state?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          address_ar?: string | null
          allow_future_dating?: boolean
          base_currency?: string
          city?: string | null
          cogs_deferral_enabled?: boolean
          costing_method?: string
          country_code?: string
          created_at?: string
          currency?: string
          email?: string | null
          fiscal_year_start?: string
          id?: string
          is_tax_registered?: boolean
          logo_url?: string | null
          name?: string
          name_ar?: string | null
          period_lock_date?: string | null
          phone?: string | null
          prices_inclusive_of_tax?: boolean
          state?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          address_city: string | null
          address_country: string | null
          address_postal: string | null
          address_state: string | null
          address_street: string | null
          billing_address_ar: string | null
          code: string | null
          company_id: string
          contact_person_email: string | null
          contact_person_name: string | null
          contact_person_phone: string | null
          created_at: string
          credit_limit: number
          currency: string
          default_price_level_id: string | null
          email: string | null
          id: string
          is_active: boolean
          mobile: string | null
          name: string
          name_ar: string | null
          notes: string | null
          payment_terms_days: number
          phone: string | null
          tax_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          address_city?: string | null
          address_country?: string | null
          address_postal?: string | null
          address_state?: string | null
          address_street?: string | null
          billing_address_ar?: string | null
          code?: string | null
          company_id: string
          contact_person_email?: string | null
          contact_person_name?: string | null
          contact_person_phone?: string | null
          created_at?: string
          credit_limit?: number
          currency: string
          default_price_level_id?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          mobile?: string | null
          name: string
          name_ar?: string | null
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          tax_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          address_city?: string | null
          address_country?: string | null
          address_postal?: string | null
          address_state?: string | null
          address_street?: string | null
          billing_address_ar?: string | null
          code?: string | null
          company_id?: string
          contact_person_email?: string | null
          contact_person_name?: string | null
          contact_person_phone?: string | null
          created_at?: string
          credit_limit?: number
          currency?: string
          default_price_level_id?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          mobile?: string | null
          name?: string
          name_ar?: string | null
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          tax_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_default_price_level_id_fkey"
            columns: ["default_price_level_id"]
            isOneToOne: false
            referencedRelation: "price_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_note_items: {
        Row: {
          cost_at_sale: number | null
          created_at: string
          credit_note_id: string
          description: string | null
          description_ar: string | null
          discount_amount: number
          discount_percent: number
          id: string
          line_subtotal: number
          line_total: number
          product_id: string | null
          quantity: number
          sort_order: number
          tax_amount: number
          tax_category: string
          tax_rate: number | null
          unit_id: string | null
          unit_price: number
        }
        Insert: {
          cost_at_sale?: number | null
          created_at?: string
          credit_note_id: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          product_id?: string | null
          quantity: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_id?: string | null
          unit_price: number
        }
        Update: {
          cost_at_sale?: number | null
          created_at?: string
          credit_note_id?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          product_id?: string | null
          quantity?: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_items_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          credit_note_number: string
          currency: string
          date: string
          discount_amount: number
          exchange_rate: number
          id: string
          linked_invoice_id: string | null
          notes: string | null
          reason: string | null
          restock: boolean
          salesperson_id: string | null
          status: string
          subtotal: number
          tax_amount: number
          total_amount: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          credit_note_number: string
          currency: string
          date: string
          discount_amount?: number
          exchange_rate?: number
          id?: string
          linked_invoice_id?: string | null
          notes?: string | null
          reason?: string | null
          restock?: boolean
          salesperson_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          credit_note_number?: string
          currency?: string
          date?: string
          discount_amount?: number
          exchange_rate?: number
          id?: string
          linked_invoice_id?: string | null
          notes?: string | null
          reason?: string | null
          restock?: boolean
          salesperson_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_linked_invoice_id_fkey"
            columns: ["linked_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      debit_note_items: {
        Row: {
          created_at: string
          debit_note_id: string
          description: string | null
          description_ar: string | null
          discount_amount: number
          discount_percent: number
          id: string
          line_subtotal: number
          line_total: number
          product_id: string | null
          quantity: number
          sort_order: number
          tax_amount: number
          tax_category: string
          tax_rate: number | null
          unit_cost: number
          unit_id: string | null
        }
        Insert: {
          created_at?: string
          debit_note_id: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          product_id?: string | null
          quantity: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_cost: number
          unit_id?: string | null
        }
        Update: {
          created_at?: string
          debit_note_id?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          product_id?: string | null
          quantity?: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_cost?: number
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "debit_note_items_debit_note_id_fkey"
            columns: ["debit_note_id"]
            isOneToOne: false
            referencedRelation: "debit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_note_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_note_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      debit_notes: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          date: string
          debit_note_number: string
          discount_amount: number
          exchange_rate: number
          id: string
          linked_bill_id: string | null
          notes: string | null
          reason: string | null
          status: string
          subtotal: number
          supplier_id: string
          tax_amount: number
          total_amount: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          currency: string
          date: string
          debit_note_number: string
          discount_amount?: number
          exchange_rate?: number
          id?: string
          linked_bill_id?: string | null
          notes?: string | null
          reason?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          date?: string
          debit_note_number?: string
          discount_amount?: number
          exchange_rate?: number
          id?: string
          linked_bill_id?: string | null
          notes?: string | null
          reason?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "debit_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_linked_bill_id_fkey"
            columns: ["linked_bill_id"]
            isOneToOne: false
            referencedRelation: "vendor_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      deferred_cogs_queue: {
        Row: {
          company_id: string
          created_at: string
          flush_unit_cost: number | null
          flushed_at: string | null
          flushed_journal_entry_id: string | null
          id: string
          invoice_item_id: string
          product_id: string
          quantity: number
          sale_date: string
          sale_invoice_id: string
          status: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          flush_unit_cost?: number | null
          flushed_at?: string | null
          flushed_journal_entry_id?: string | null
          id?: string
          invoice_item_id: string
          product_id: string
          quantity: number
          sale_date: string
          sale_invoice_id: string
          status?: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          flush_unit_cost?: number | null
          flushed_at?: string | null
          flushed_journal_entry_id?: string | null
          id?: string
          invoice_item_id?: string
          product_id?: string
          quantity?: number
          sale_date?: string
          sale_invoice_id?: string
          status?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deferred_cogs_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deferred_cogs_queue_flushed_journal_entry_id_fkey"
            columns: ["flushed_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deferred_cogs_queue_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deferred_cogs_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deferred_cogs_queue_sale_invoice_id_fkey"
            columns: ["sale_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deferred_cogs_queue_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          company_id: string
          created_at: string
          current_value: number
          format: string
          last_reset_year: number | null
          pad_zeros: number
          prefix: string
          reset_yearly: boolean
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          current_value?: number
          format?: string
          last_reset_year?: number | null
          pad_zeros?: number
          prefix: string
          reset_yearly?: boolean
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          current_value?: number
          format?: string
          last_reset_year?: number | null
          pad_zeros?: number
          prefix?: string
          reset_yearly?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          date: string
          description: string
          expense_account_id: string
          expense_number: string
          id: string
          paid_from_account_id: string
          receipt_url: string | null
          reference: string | null
          status: string
          supplier_id: string | null
          tax_amount: number
          total_amount: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          date: string
          description: string
          expense_account_id: string
          expense_number: string
          id?: string
          paid_from_account_id: string
          receipt_url?: string | null
          reference?: string | null
          status?: string
          supplier_id?: string | null
          tax_amount?: number
          total_amount: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          date?: string
          description?: string
          expense_account_id?: string
          expense_number?: string
          id?: string
          paid_from_account_id?: string
          receipt_url?: string | null
          reference?: string | null
          status?: string
          supplier_id?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_paid_from_account_id_fkey"
            columns: ["paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      general_ledger: {
        Row: {
          account_code: string
          account_id: string
          company_id: string
          contact_id: string | null
          created_at: string
          credit: number
          date: string
          debit: number
          description: string | null
          id: string
          journal_entry_id: string
          related_doc_id: string | null
          related_doc_type: string | null
          reversal_of_id: string | null
        }
        Insert: {
          account_code: string
          account_id: string
          company_id: string
          contact_id?: string | null
          created_at?: string
          credit?: number
          date: string
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id: string
          related_doc_id?: string | null
          related_doc_type?: string | null
          reversal_of_id?: string | null
        }
        Update: {
          account_code?: string
          account_id?: string
          company_id?: string
          contact_id?: string | null
          created_at?: string
          credit?: number
          date?: string
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id?: string
          related_doc_id?: string | null
          related_doc_type?: string | null
          reversal_of_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "general_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "general_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "gl_active"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_items: {
        Row: {
          created_at: string
          grn_id: string
          id: string
          notes: string | null
          product_id: string
          qty_received: number
          serial_numbers: string[] | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          grn_id: string
          id?: string
          notes?: string | null
          product_id: string
          qty_received: number
          serial_numbers?: string[] | null
          total_cost?: number
          unit_cost: number
        }
        Update: {
          created_at?: string
          grn_id?: string
          id?: string
          notes?: string | null
          product_id?: string
          qty_received?: number
          serial_numbers?: string[] | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          company_id: string
          created_at: string
          date: string
          grn_number: string
          id: string
          notes: string | null
          purchase_order_id: string | null
          status: string
          supplier_id: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          date: string
          grn_number: string
          id?: string
          notes?: string | null
          purchase_order_id?: string | null
          status?: string
          supplier_id: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          date?: string
          grn_number?: string
          id?: string
          notes?: string | null
          purchase_order_id?: string | null
          status?: string
          supplier_id?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustment_items: {
        Row: {
          actual_qty: number
          adjustment_id: string
          created_at: string
          difference: number
          id: string
          notes: string | null
          product_id: string
          system_qty: number
          unit_cost: number | null
        }
        Insert: {
          actual_qty: number
          adjustment_id: string
          created_at?: string
          difference: number
          id?: string
          notes?: string | null
          product_id: string
          system_qty: number
          unit_cost?: number | null
        }
        Update: {
          actual_qty?: number
          adjustment_id?: string
          created_at?: string
          difference?: number
          id?: string
          notes?: string | null
          product_id?: string
          system_qty?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustment_items_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "inventory_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustment_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustments: {
        Row: {
          adjustment_number: string
          company_id: string
          created_at: string
          date: string
          id: string
          notes: string | null
          reason: string
          status: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          adjustment_number: string
          company_id: string
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          reason: string
          status?: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          adjustment_number?: string
          company_id?: string
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          reason?: string
          status?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          cost_at_sale: number | null
          created_at: string
          description: string | null
          description_ar: string | null
          discount_amount: number
          discount_percent: number
          id: string
          invoice_id: string
          line_subtotal: number
          line_total: number
          product_id: string | null
          quantity: number
          serial_id: string | null
          sort_order: number
          tax_amount: number
          tax_category: string
          tax_rate: number | null
          unit_id: string | null
          unit_price: number
        }
        Insert: {
          cost_at_sale?: number | null
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          invoice_id: string
          line_subtotal?: number
          line_total?: number
          product_id?: string | null
          quantity: number
          serial_id?: string | null
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_id?: string | null
          unit_price: number
        }
        Update: {
          cost_at_sale?: number | null
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          invoice_id?: string
          line_subtotal?: number
          line_total?: number
          product_id?: string | null
          quantity?: number
          serial_id?: string | null
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_serial_id_fkey"
            columns: ["serial_id"]
            isOneToOne: false
            referencedRelation: "product_serials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          currency: string
          date: string
          discount_amount: number
          due_date: string | null
          exchange_rate: number
          id: string
          invoice_number: string
          notes: string | null
          pos_session_id: string | null
          price_level_id: string | null
          prices_inclusive: boolean
          reference: string | null
          sale_channel: string
          salesperson_id: string | null
          source_order_id: string | null
          source_quote_id: string | null
          status: string
          subtotal: number
          tax_amount: number
          terms: string | null
          terms_ar: string | null
          total_amount: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          warehouse_id: string | null
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          currency: string
          date: string
          discount_amount?: number
          due_date?: string | null
          exchange_rate?: number
          id?: string
          invoice_number: string
          notes?: string | null
          pos_session_id?: string | null
          price_level_id?: string | null
          prices_inclusive?: boolean
          reference?: string | null
          sale_channel?: string
          salesperson_id?: string | null
          source_order_id?: string | null
          source_quote_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          terms?: string | null
          terms_ar?: string | null
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          currency?: string
          date?: string
          discount_amount?: number
          due_date?: string | null
          exchange_rate?: number
          id?: string
          invoice_number?: string
          notes?: string | null
          pos_session_id?: string | null
          price_level_id?: string | null
          prices_inclusive?: boolean
          reference?: string | null
          sale_channel?: string
          salesperson_id?: string | null
          source_order_id?: string | null
          source_quote_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          terms?: string | null
          terms_ar?: string | null
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_pos_session_id_fkey"
            columns: ["pos_session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_price_level_id_fkey"
            columns: ["price_level_id"]
            isOneToOne: false
            referencedRelation: "price_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_source_quote_id_fkey"
            columns: ["source_quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          currency: string | null
          date: string
          description: string
          entry_number: string
          exchange_rate: number
          id: string
          reversal_of_id: string | null
          reversed_by_id: string | null
          source_id: string | null
          source_type: string
          total_credit: number
          total_debit: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          date: string
          description: string
          entry_number: string
          exchange_rate?: number
          id?: string
          reversal_of_id?: string | null
          reversed_by_id?: string | null
          source_id?: string | null
          source_type: string
          total_credit: number
          total_debit: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          date?: string
          description?: string
          entry_number?: string
          exchange_rate?: number
          id?: string
          reversal_of_id?: string | null
          reversed_by_id?: string | null
          source_id?: string | null
          source_type?: string
          total_credit?: number
          total_debit?: number
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_by_id_fkey"
            columns: ["reversed_by_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_read: boolean
          link_to: string | null
          message: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          link_to?: string | null
          message?: string | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          link_to?: string | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          amount_applied: number
          company_id: string
          created_at: string
          doc_id: string
          doc_type: string
          id: string
          payment_id: string
        }
        Insert: {
          amount_applied: number
          company_id: string
          created_at?: string
          doc_id: string
          doc_type: string
          id?: string
          payment_id: string
        }
        Update: {
          amount_applied?: number
          company_id?: string
          created_at?: string
          doc_id?: string
          doc_type?: string
          id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_ar: string | null
          type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_ar?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_ar?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          classification: string
          company_id: string
          contact_id: string
          created_at: string
          currency: string
          date: string
          exchange_rate: number
          id: string
          notes: string | null
          payment_method_id: string | null
          payment_number: string
          reference: string | null
          status: string
          type: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          classification: string
          company_id: string
          contact_id: string
          created_at?: string
          currency: string
          date: string
          exchange_rate?: number
          id?: string
          notes?: string | null
          payment_method_id?: string | null
          payment_number: string
          reference?: string | null
          status?: string
          type: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          classification?: string
          company_id?: string
          contact_id?: string
          created_at?: string
          currency?: string
          date?: string
          exchange_rate?: number
          id?: string
          notes?: string | null
          payment_method_id?: string | null
          payment_number?: string
          reference?: string | null
          status?: string
          type?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pdc_cheques: {
        Row: {
          amount: number
          bank_name: string | null
          cheque_number: string
          company_id: string
          contact_id: string
          created_at: string
          currency: string
          deposit_account_id: string | null
          due_date: string
          id: string
          issue_date: string
          linked_payment_id: string | null
          notes: string | null
          pdc_number: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          bank_name?: string | null
          cheque_number: string
          company_id: string
          contact_id: string
          created_at?: string
          currency: string
          deposit_account_id?: string | null
          due_date: string
          id?: string
          issue_date: string
          linked_payment_id?: string | null
          notes?: string | null
          pdc_number: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_name?: string | null
          cheque_number?: string
          company_id?: string
          contact_id?: string
          created_at?: string
          currency?: string
          deposit_account_id?: string | null
          due_date?: string
          id?: string
          issue_date?: string
          linked_payment_id?: string | null
          notes?: string | null
          pdc_number?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdc_cheques_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdc_cheques_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdc_cheques_deposit_account_id_fkey"
            columns: ["deposit_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdc_cheques_linked_payment_id_fkey"
            columns: ["linked_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sessions: {
        Row: {
          cash_variance: number | null
          closed_at: string | null
          closing_cash_counted: number | null
          closing_cash_expected: number | null
          company_id: string
          created_at: string
          id: string
          notes: string | null
          opened_at: string
          opening_cash: number
          session_number: string
          status: string
          total_sales_amount: number | null
          total_sales_count: number | null
          updated_at: string
          user_id: string
          variance_reason: string | null
          warehouse_id: string
        }
        Insert: {
          cash_variance?: number | null
          closed_at?: string | null
          closing_cash_counted?: number | null
          closing_cash_expected?: number | null
          company_id: string
          created_at?: string
          id?: string
          notes?: string | null
          opened_at: string
          opening_cash: number
          session_number: string
          status?: string
          total_sales_amount?: number | null
          total_sales_count?: number | null
          updated_at?: string
          user_id: string
          variance_reason?: string | null
          warehouse_id: string
        }
        Update: {
          cash_variance?: number | null
          closed_at?: string | null
          closing_cash_counted?: number | null
          closing_cash_expected?: number | null
          company_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          opened_at?: string
          opening_cash?: number
          session_number?: string
          status?: string
          total_sales_amount?: number | null
          total_sales_count?: number | null
          updated_at?: string
          user_id?: string
          variance_reason?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sessions_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      price_levels: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          markup_percent: number | null
          name: string
          name_ar: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          markup_percent?: number | null
          name: string
          name_ar?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          markup_percent?: number | null
          name?: string
          name_ar?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_levels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      print_templates: {
        Row: {
          accent_color: string | null
          bilingual_print: boolean
          company_id: string
          created_at: string
          document_type: string
          footer_text_ar: string | null
          footer_text_en: string | null
          id: string
          is_default: boolean
          paper_size: string
          primary_color: string | null
          show_due_date: boolean
          show_salesperson: boolean
          show_terms: boolean
          template_name: string
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          bilingual_print?: boolean
          company_id: string
          created_at?: string
          document_type: string
          footer_text_ar?: string | null
          footer_text_en?: string | null
          id?: string
          is_default?: boolean
          paper_size?: string
          primary_color?: string | null
          show_due_date?: boolean
          show_salesperson?: boolean
          show_terms?: boolean
          template_name: string
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          bilingual_print?: boolean
          company_id?: string
          created_at?: string
          document_type?: string
          footer_text_ar?: string | null
          footer_text_en?: string | null
          id?: string
          is_default?: boolean
          paper_size?: string
          primary_color?: string | null
          show_due_date?: boolean
          show_salesperson?: boolean
          show_terms?: boolean
          template_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      product_compatibility: {
        Row: {
          created_at: string
          engine: string | null
          id: string
          make_id: string
          model_id: string | null
          notes: string | null
          product_id: string
          year_from: number | null
          year_to: number | null
        }
        Insert: {
          created_at?: string
          engine?: string | null
          id?: string
          make_id: string
          model_id?: string | null
          notes?: string | null
          product_id: string
          year_from?: number | null
          year_to?: number | null
        }
        Update: {
          created_at?: string
          engine?: string | null
          id?: string
          make_id?: string
          model_id?: string | null
          notes?: string | null
          product_id?: string
          year_from?: number | null
          year_to?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_compatibility_make_id_fkey"
            columns: ["make_id"]
            isOneToOne: false
            referencedRelation: "vehicle_makes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_compatibility_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "vehicle_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_compatibility_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_price_levels: {
        Row: {
          created_at: string
          id: string
          price: number
          price_level_id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          price: number
          price_level_id: string
          product_id: string
        }
        Update: {
          created_at?: string
          id?: string
          price?: number
          price_level_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_price_levels_price_level_id_fkey"
            columns: ["price_level_id"]
            isOneToOne: false
            referencedRelation: "price_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_serials: {
        Row: {
          company_id: string
          created_at: string
          id: string
          notes: string | null
          product_id: string
          purchase_bill_id: string | null
          purchase_date: string | null
          sale_date: string | null
          sale_invoice_id: string | null
          serial_number: string
          status: string
          updated_at: string
          warehouse_id: string | null
          warranty_expiry: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          purchase_bill_id?: string | null
          purchase_date?: string | null
          sale_date?: string | null
          sale_invoice_id?: string | null
          serial_number: string
          status: string
          updated_at?: string
          warehouse_id?: string | null
          warranty_expiry?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          purchase_bill_id?: string | null
          purchase_date?: string | null
          sale_date?: string | null
          sale_invoice_id?: string | null
          serial_number?: string
          status?: string
          updated_at?: string
          warehouse_id?: string | null
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_serials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_serials_purchase_bill_id_fkey"
            columns: ["purchase_bill_id"]
            isOneToOne: false
            referencedRelation: "vendor_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_serials_sale_invoice_id_fkey"
            columns: ["sale_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_serials_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      product_supplier_codes: {
        Row: {
          company_id: string
          created_at: string
          id: string
          last_purchase_date: string | null
          last_purchase_price: number | null
          product_id: string
          supplier_id: string
          supplier_sku: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          last_purchase_date?: string | null
          last_purchase_price?: number | null
          product_id: string
          supplier_id: string
          supplier_sku: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          last_purchase_date?: string | null
          last_purchase_price?: number | null
          product_id?: string
          supplier_id?: string
          supplier_sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_supplier_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_supplier_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_supplier_codes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          brand_id: string | null
          category_id: string | null
          company_id: string
          created_at: string
          description: string | null
          description_ar: string | null
          id: string
          image_urls: string[] | null
          is_active: boolean
          max_stock_level: number | null
          min_stock_level: number
          name: string
          name_ar: string | null
          oe_number: string | null
          quality_tier: string | null
          replacement_numbers: string[] | null
          requires_serial: boolean
          selling_price: number
          sku: string
          tax_category: string
          unit_id: string | null
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          barcode?: string | null
          brand_id?: string | null
          category_id?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          description_ar?: string | null
          id?: string
          image_urls?: string[] | null
          is_active?: boolean
          max_stock_level?: number | null
          min_stock_level?: number
          name: string
          name_ar?: string | null
          oe_number?: string | null
          quality_tier?: string | null
          replacement_numbers?: string[] | null
          requires_serial?: boolean
          selling_price?: number
          sku: string
          tax_category?: string
          unit_id?: string | null
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          barcode?: string | null
          brand_id?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          description_ar?: string | null
          id?: string
          image_urls?: string[] | null
          is_active?: boolean
          max_stock_level?: number | null
          min_stock_level?: number
          name?: string
          name_ar?: string | null
          oe_number?: string | null
          quality_tier?: string | null
          replacement_numbers?: string[] | null
          requires_serial?: boolean
          selling_price?: number
          sku?: string
          tax_category?: string
          unit_id?: string | null
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          assigned_warehouse_id: string | null
          company_id: string
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          assigned_warehouse_id?: string | null
          company_id: string
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          last_login_at?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          assigned_warehouse_id?: string | null
          company_id?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_assigned_warehouse_id_fkey"
            columns: ["assigned_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string
          description: string | null
          description_ar: string | null
          discount_amount: number
          discount_percent: number
          id: string
          line_subtotal: number
          line_total: number
          po_id: string
          product_id: string | null
          quantity: number
          sort_order: number
          tax_amount: number
          tax_category: string
          tax_rate: number | null
          unit_cost: number
          unit_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          po_id: string
          product_id?: string | null
          quantity: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_cost: number
          unit_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          po_id?: string
          product_id?: string | null
          quantity?: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_cost?: number
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          buyer_id: string | null
          company_id: string
          created_at: string
          currency: string
          date: string
          discount_amount: number
          exchange_rate: number
          expected_delivery_date: string | null
          id: string
          notes: string | null
          po_number: string
          reference: string | null
          status: string
          subtotal: number
          supplier_id: string
          tax_amount: number
          terms: string | null
          terms_ar: string | null
          total_amount: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          buyer_id?: string | null
          company_id: string
          created_at?: string
          currency: string
          date: string
          discount_amount?: number
          exchange_rate?: number
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          po_number: string
          reference?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          tax_amount?: number
          terms?: string | null
          terms_ar?: string | null
          total_amount?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          buyer_id?: string | null
          company_id?: string
          created_at?: string
          currency?: string
          date?: string
          discount_amount?: number
          exchange_rate?: number
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          po_number?: string
          reference?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          tax_amount?: number
          terms?: string | null
          terms_ar?: string | null
          total_amount?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order_items: {
        Row: {
          created_at: string
          description: string | null
          description_ar: string | null
          discount_amount: number
          discount_percent: number
          id: string
          line_subtotal: number
          line_total: number
          order_id: string
          product_id: string | null
          quantity: number
          sort_order: number
          tax_amount: number
          tax_category: string
          tax_rate: number | null
          unit_id: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          order_id: string
          product_id?: string | null
          quantity: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_id?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          order_id?: string
          product_id?: string | null
          quantity?: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          currency: string
          date: string
          discount_amount: number
          exchange_rate: number
          expected_delivery_date: string | null
          id: string
          notes: string | null
          order_number: string
          price_level_id: string | null
          prices_inclusive: boolean
          reference: string | null
          salesperson_id: string | null
          source_quote_id: string | null
          status: string
          subtotal: number
          tax_amount: number
          terms: string | null
          terms_ar: string | null
          total_amount: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          currency: string
          date: string
          discount_amount?: number
          exchange_rate?: number
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_number: string
          price_level_id?: string | null
          prices_inclusive?: boolean
          reference?: string | null
          salesperson_id?: string | null
          source_quote_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          terms?: string | null
          terms_ar?: string | null
          total_amount?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          currency?: string
          date?: string
          discount_amount?: number
          exchange_rate?: number
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          price_level_id?: string | null
          prices_inclusive?: boolean
          reference?: string | null
          salesperson_id?: string | null
          source_quote_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          terms?: string | null
          terms_ar?: string | null
          total_amount?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_price_level_id_fkey"
            columns: ["price_level_id"]
            isOneToOne: false
            referencedRelation: "price_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_source_quote_id_fkey"
            columns: ["source_quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quote_items: {
        Row: {
          created_at: string
          description: string | null
          description_ar: string | null
          discount_amount: number
          discount_percent: number
          id: string
          line_subtotal: number
          line_total: number
          product_id: string | null
          quantity: number
          quote_id: string
          sort_order: number
          tax_amount: number
          tax_category: string
          tax_rate: number | null
          unit_id: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          product_id?: string | null
          quantity: number
          quote_id: string
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_id?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          product_id?: string | null
          quantity?: number
          quote_id?: string
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quotes: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          currency: string
          date: string
          discount_amount: number
          exchange_rate: number
          expiry_date: string | null
          id: string
          invoiced_amount: number
          notes: string | null
          price_level_id: string | null
          prices_inclusive: boolean
          quote_number: string
          reference: string | null
          salesperson_id: string | null
          status: string
          subtotal: number
          tax_amount: number
          terms: string | null
          terms_ar: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          currency: string
          date: string
          discount_amount?: number
          exchange_rate?: number
          expiry_date?: string | null
          id?: string
          invoiced_amount?: number
          notes?: string | null
          price_level_id?: string | null
          prices_inclusive?: boolean
          quote_number: string
          reference?: string | null
          salesperson_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          terms?: string | null
          terms_ar?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          currency?: string
          date?: string
          discount_amount?: number
          exchange_rate?: number
          expiry_date?: string | null
          id?: string
          invoiced_amount?: number
          notes?: string | null
          price_level_id?: string | null
          prices_inclusive?: boolean
          quote_number?: string
          reference?: string | null
          salesperson_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          terms?: string | null
          terms_ar?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_price_level_id_fkey"
            columns: ["price_level_id"]
            isOneToOne: false
            referencedRelation: "price_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_return_items: {
        Row: {
          condition: string | null
          created_at: string
          id: string
          product_id: string | null
          qty_returned: number
          restock_warehouse_id: string | null
          sales_return_id: string
          unit_cost: number | null
        }
        Insert: {
          condition?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          qty_returned: number
          restock_warehouse_id?: string | null
          sales_return_id: string
          unit_cost?: number | null
        }
        Update: {
          condition?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          qty_returned?: number
          restock_warehouse_id?: string | null
          sales_return_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_items_restock_warehouse_id_fkey"
            columns: ["restock_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_items_sales_return_id_fkey"
            columns: ["sales_return_id"]
            isOneToOne: false
            referencedRelation: "sales_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_returns: {
        Row: {
          company_id: string
          created_at: string
          credit_note_id: string | null
          date: string
          id: string
          invoice_id: string
          notes: string | null
          reason: string | null
          return_number: string
          status: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          credit_note_id?: string | null
          date: string
          id?: string
          invoice_id: string
          notes?: string | null
          reason?: string | null
          return_number: string
          status?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          credit_note_id?: string | null
          date?: string
          id?: string
          invoice_id?: string
          notes?: string | null
          reason?: string | null
          return_number?: string
          status?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_returns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ledger: {
        Row: {
          company_id: string
          created_at: string
          date: string
          direction: number
          id: string
          notes: string | null
          product_id: string
          quantity: number
          related_doc_id: string | null
          related_doc_type: string | null
          reversal_of_id: string | null
          running_avg_cost: number | null
          running_qty: number | null
          total_cost: number
          type: string
          unit_cost: number
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          date: string
          direction: number
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          related_doc_id?: string | null
          related_doc_type?: string | null
          reversal_of_id?: string | null
          running_avg_cost?: number | null
          running_qty?: number | null
          total_cost: number
          type: string
          unit_cost: number
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          date?: string
          direction?: number
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          related_doc_id?: string | null
          related_doc_type?: string | null
          reversal_of_id?: string | null
          running_avg_cost?: number | null
          running_qty?: number | null
          total_cost?: number
          type?: string
          unit_cost?: number
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "stock_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "stock_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_items: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity: number
          transfer_id: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          transfer_id: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          transfer_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          company_id: string
          created_at: string
          date: string
          from_warehouse_id: string
          id: string
          notes: string | null
          status: string
          to_warehouse_id: string
          transfer_number: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          date: string
          from_warehouse_id: string
          id?: string
          notes?: string | null
          status?: string
          to_warehouse_id: string
          transfer_number: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          date?: string
          from_warehouse_id?: string
          id?: string
          notes?: string | null
          status?: string
          to_warehouse_id?: string
          transfer_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          coa_input_account_id: string | null
          coa_output_account_id: string | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          rate: number
          tax_type: string
          updated_at: string
        }
        Insert: {
          coa_input_account_id?: string | null
          coa_output_account_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          rate: number
          tax_type: string
          updated_at?: string
        }
        Update: {
          coa_input_account_id?: string | null
          coa_output_account_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          rate?: number
          tax_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_coa_input_account_id_fkey"
            columns: ["coa_input_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rates_coa_output_account_id_fkey"
            columns: ["coa_output_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      units_of_measure: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          name: string
          name_ar: string | null
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          name: string
          name_ar?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          name_ar?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_of_measure_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_makes: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_makes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_models: {
        Row: {
          chassis_code: string | null
          created_at: string
          id: string
          make_id: string
          name: string
        }
        Insert: {
          chassis_code?: string | null
          created_at?: string
          id?: string
          make_id: string
          name: string
        }
        Update: {
          chassis_code?: string | null
          created_at?: string
          id?: string
          make_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_models_make_id_fkey"
            columns: ["make_id"]
            isOneToOne: false
            referencedRelation: "vehicle_makes"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_bill_items: {
        Row: {
          bill_id: string
          created_at: string
          description: string | null
          description_ar: string | null
          discount_amount: number
          discount_percent: number
          id: string
          line_subtotal: number
          line_total: number
          linked_grn_item_id: string | null
          product_id: string | null
          quantity: number
          sort_order: number
          tax_amount: number
          tax_category: string
          tax_rate: number | null
          unit_cost: number
          unit_id: string | null
        }
        Insert: {
          bill_id: string
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          linked_grn_item_id?: string | null
          product_id?: string | null
          quantity: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_cost: number
          unit_id?: string | null
        }
        Update: {
          bill_id?: string
          created_at?: string
          description?: string | null
          description_ar?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          line_subtotal?: number
          line_total?: number
          linked_grn_item_id?: string | null
          product_id?: string | null
          quantity?: number
          sort_order?: number
          tax_amount?: number
          tax_category?: string
          tax_rate?: number | null
          unit_cost?: number
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_bill_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "vendor_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bill_items_linked_grn_item_id_fkey"
            columns: ["linked_grn_item_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bill_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bill_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_bills: {
        Row: {
          bill_number: string
          company_id: string
          created_at: string
          currency: string
          date: string
          discount_amount: number
          due_date: string | null
          exchange_rate: number
          id: string
          linked_grn_id: string | null
          notes: string | null
          reference: string | null
          status: string
          subtotal: number
          supplier_bill_number: string | null
          supplier_id: string
          tax_amount: number
          total_amount: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          bill_number: string
          company_id: string
          created_at?: string
          currency: string
          date: string
          discount_amount?: number
          due_date?: string | null
          exchange_rate?: number
          id?: string
          linked_grn_id?: string | null
          notes?: string | null
          reference?: string | null
          status?: string
          subtotal?: number
          supplier_bill_number?: string | null
          supplier_id: string
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          bill_number?: string
          company_id?: string
          created_at?: string
          currency?: string
          date?: string
          discount_amount?: number
          due_date?: string | null
          exchange_rate?: number
          id?: string
          linked_grn_id?: string | null
          notes?: string | null
          reference?: string | null
          status?: string
          subtotal?: number
          supplier_bill_number?: string | null
          supplier_id?: string
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_bills_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bills_linked_grn_id_fkey"
            columns: ["linked_grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bills_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bills_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          city: string | null
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          name_ar: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          name_ar?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          name_ar?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      gl_active: {
        Row: {
          account_code: string | null
          account_id: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string | null
          credit: number | null
          date: string | null
          debit: number | null
          description: string | null
          id: string | null
          journal_entry_id: string | null
          related_doc_id: string | null
          related_doc_type: string | null
          reversal_of_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "general_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "general_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_ledger_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "gl_active"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_active: {
        Row: {
          company_id: string | null
          created_at: string | null
          date: string | null
          direction: number | null
          id: string | null
          notes: string | null
          product_id: string | null
          quantity: number | null
          related_doc_id: string | null
          related_doc_type: string | null
          reversal_of_id: string | null
          running_avg_cost: number | null
          running_qty: number | null
          total_cost: number | null
          type: string | null
          unit_cost: number | null
          warehouse_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          date?: string | null
          direction?: number | null
          id?: string | null
          notes?: string | null
          product_id?: string | null
          quantity?: number | null
          related_doc_id?: string | null
          related_doc_type?: string | null
          reversal_of_id?: string | null
          running_avg_cost?: number | null
          running_qty?: number | null
          total_cost?: number | null
          type?: string | null
          unit_cost?: number | null
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          date?: string | null
          direction?: number | null
          id?: string | null
          notes?: string | null
          product_id?: string | null
          quantity?: number | null
          related_doc_id?: string | null
          related_doc_type?: string | null
          reversal_of_id?: string | null
          running_avg_cost?: number | null
          running_qty?: number | null
          total_cost?: number | null
          type?: string | null
          unit_cost?: number | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "stock_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "stock_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      complete_onboarding: { Args: { p_data: Json }; Returns: Json }
      current_user_company_id: { Args: never; Returns: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
