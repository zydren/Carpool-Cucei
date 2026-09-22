import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import {
  formatNotificationDate,
  getMyNotifications,
  getUnreadNotificationsCount,
  markAllMyNotificationsAsRead,
  markNotificationAsRead,
  notificationTargetPath,
} from '../services/notificationService';
import type { AppNotification } from '../services/notificationService';

interface NotificationBellProps {
  /**
   * Lado hacia el que se abre el panel. En el menú móvil conviene 'left'
   * para que no se salga de la pantalla.
   */
  align?: 'right' | 'left';
  /** Se llama al navegar a "Mis viajes" (el navbar móvil lo usa para cerrarse). */
  onNavigate?: () => void;
  className?: string;
}

/** Máximo de notificaciones que se listan en el desplegable. */
const NOTIFICATIONS_LIMIT = 20;

/**
 * Campana de notificaciones del navbar.
 *
 * - Muestra el contador de no leídas.
 * - Al abrirse lista mensaje, título, fecha/hora y estado leído/no leído.
 * - Permite marcar una notificación como leída (clic o botón) y todas a la vez.
 * - Al hacer clic navega a "Mis viajes" en la pestaña que corresponde al tipo.
 * - Los errores se registran en consola y NUNCA rompen la navegación: si la
 *   migración de notificaciones todavía no está aplicada, la campana queda
 *   vacía y el resto de la aplicación sigue funcionando igual.
 */
const NotificationBell = ({
  align = 'right',
  onNavigate,
  className = '',
}: NotificationBellProps) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  /** Carga la lista y el contador de no leídas. */
  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const [list, count] = await Promise.all([
        getMyNotifications(NOTIFICATIONS_LIMIT),
        getUnreadNotificationsCount(),
      ]);
      setNotifications(list);
      setUnreadCount(count);
    } catch (error) {
      console.warn('No se pudieron cargar las notificaciones:', error);
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Carga inicial diferida (el navbar se monta en cada página): evita el
  // setState síncrono dentro del cuerpo del efecto.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  // Cierre al hacer clic fuera o con la tecla Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = () => {
    const nextIsOpen = !isOpen;
    setIsOpen(nextIsOpen);

    // Al abrir se refresca para reflejar lo último que ocurrió.
    if (nextIsOpen) {
      void refresh();
    }
  };

  /** Clic en una notificación: se marca leída y se navega a "Mis viajes". */
  const handleOpenNotification = async (notification: AppNotification) => {
    setIsOpen(false);
    onNavigate?.();

    if (!notification.read) {
      // Actualización optimista: el contador baja aunque el UPDATE tarde.
      setNotifications((prev) =>
        prev.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      try {
        await markNotificationAsRead(notification.id);
      } catch (error) {
        console.warn('No se pudo marcar la notificación como leída:', error);
      }
    }

    navigate(notificationTargetPath[notification.type] ?? '/mis-viajes');
  };

  /** Botón "Marcar leída" de una notificación concreta. */
  const handleMarkOneAsRead = async (notification: AppNotification) => {
    setProcessingId(notification.id);

    try {
      await markNotificationAsRead(notification.id);
      setNotifications((prev) =>
        prev.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.warn('No se pudo marcar la notificación como leída:', error);
    } finally {
      setProcessingId(null);
    }
  };

  /** Botón "Marcar todas como leídas". */
  const handleMarkAllAsRead = async () => {
    try {
      await markAllMyNotificationsAsRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.warn('No se pudieron marcar todas las notificaciones como leídas:', error);
    }
  };


  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        className="relative inline-flex items-center justify-center p-2 rounded-full text-gray-600 hover:text-indigo-600 hover:bg-gray-100 transition-colors"
        aria-label={
          unreadCount > 0 ? `Notificaciones (${unreadCount} sin leer)` : 'Notificaciones'
        }
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[11px] font-semibold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className={`absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-lg z-50`}
          aria-label="Notificaciones"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Notificaciones</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllAsRead()}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Marcar todas como leídas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading && notifications.length === 0 ? (
              <p className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Cargando notificaciones...
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">
                No tienes notificaciones nuevas.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <div
                      className={`flex items-start gap-3 px-4 py-3 ${
                        notification.read ? 'bg-white' : 'bg-indigo-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void handleOpenNotification(notification)}
                        className="flex-1 text-left"
                      >
                        <span className="flex items-center gap-2">
                          {!notification.read && (
                            <span
                              className="w-2 h-2 rounded-full bg-indigo-600 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <span
                            className={`text-sm ${
                              notification.read
                                ? 'font-medium text-gray-800'
                                : 'font-semibold text-gray-900'
                            }`}
                          >
                            {notification.title}
                          </span>
                        </span>
                        <span className="block mt-0.5 text-sm text-gray-600">
                          {notification.message}
                        </span>
                        <span className="block mt-1 text-xs text-gray-400">
                          {formatNotificationDate(notification.created_at)}
                          {notification.read ? '' : ' · No leída'}
                        </span>
                      </button>

                      {!notification.read && (
                        <button
                          type="button"
                          onClick={() => void handleMarkOneAsRead(notification)}
                          disabled={processingId === notification.id}
                          className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:text-gray-400"
                          title="Marcar como leída"
                        >
                          {processingId === notification.id ? '...' : 'Marcar leída'}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>


          <div className="px-4 py-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onNavigate?.();
                navigate('/mis-viajes');
              }}
              className="w-full text-center text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Ver Mis viajes
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
