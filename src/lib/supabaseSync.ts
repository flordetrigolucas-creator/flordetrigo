/**
 * Sincronizador Bidirecional Supabase <-> IndexedDB (Dexie.js) + Realtime.
 *
 * - Ao autenticar no Supabase, baixa o estado real das tabelas (`items`, `inventory_batches`,
 *   `technical_sheets`, `technical_sheet_items`, `production_orders`, `production_alerts`,
 *   `waste_and_transformations`, `crm_customers`, `crm_conversations`, `crm_messages`) para o IndexedDB.
 * - Inscreve nos canais Supabase Realtime para atualizar a Tela do Padeiro (PCP) e o Inbox CRM ao vivo.
 */
import { supabase } from '@/lib/supabase';
import { localDb } from '@/lib/offlineDb';

export async function pullSupabaseToLocalCache(): Promise<boolean> {
  try {
    const [
      itemsRes,
      batchesRes,
      sheetsRes,
      sheetItemsRes,
      ordersRes,
      alertsRes,
      wasteRes,
      customersRes,
      convsRes,
      msgsRes,
    ] = await Promise.all([
      supabase.from('items').select('*'),
      supabase.from('inventory_batches').select('*'),
      supabase.from('technical_sheets').select('*'),
      supabase.from('technical_sheet_items').select('*'),
      supabase.from('production_orders').select('*'),
      supabase.from('production_alerts').select('*'),
      supabase.from('waste_and_transformations').select('*'),
      supabase.from('crm_customers').select('*'),
      supabase.from('crm_conversations').select('*'),
      supabase.from('crm_messages').select('*'),
    ]);

    if (itemsRes.error) {
      return false;
    }

    await localDb.transaction(
      'rw',
      [
        localDb.items,
        localDb.inventoryBatches,
        localDb.technicalSheets,
        localDb.technicalSheetItems,
        localDb.productionOrders,
        localDb.productionAlerts,
        localDb.wasteRecords,
        localDb.customers,
        localDb.conversations,
        localDb.messages,
      ],
      async () => {
        if (itemsRes.data?.length) {
          await localDb.items.clear();
          await localDb.items.bulkPut(itemsRes.data);
        }
        if (batchesRes.data) {
          await localDb.inventoryBatches.clear();
          await localDb.inventoryBatches.bulkPut(batchesRes.data);
        }
        if (sheetsRes.data?.length) {
          await localDb.technicalSheets.clear();
          await localDb.technicalSheets.bulkPut(sheetsRes.data);
        }
        if (sheetItemsRes.data?.length) {
          await localDb.technicalSheetItems.clear();
          await localDb.technicalSheetItems.bulkPut(sheetItemsRes.data);
        }
        if (ordersRes.data) {
          await localDb.productionOrders.clear();
          await localDb.productionOrders.bulkPut(ordersRes.data);
        }
        if (alertsRes.data) {
          await localDb.productionAlerts.clear();
          await localDb.productionAlerts.bulkPut(alertsRes.data);
        }
        if (wasteRes.data) {
          await localDb.wasteRecords.clear();
          await localDb.wasteRecords.bulkPut(wasteRes.data);
        }
        if (customersRes.data?.length) {
          await localDb.customers.clear();
          await localDb.customers.bulkPut(customersRes.data);
        }
        if (convsRes.data) {
          await localDb.conversations.clear();
          await localDb.conversations.bulkPut(convsRes.data);
        }
        if (msgsRes.data) {
          await localDb.messages.clear();
          await localDb.messages.bulkPut(msgsRes.data);
        }
      },
    );

    return true;
  } catch {
    return false;
  }
}

export function subscribeSupabaseRealtime(): () => void {
  const channel = supabase
    .channel('flor-do-trigo-live-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
      void pullSupabaseToLocalCache();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, () => {
      void pullSupabaseToLocalCache();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'production_alerts' }, () => {
      void pullSupabaseToLocalCache();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversations' }, () => {
      void pullSupabaseToLocalCache();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_messages' }, () => {
      void pullSupabaseToLocalCache();
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

