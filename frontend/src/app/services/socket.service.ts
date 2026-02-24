import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket;
  public baseUrl: string = environment.socketUrl;

  constructor() {
    this.socket = io(this.baseUrl, {
      transports: ['polling'],  // Force polling only — Render blocks WebSocket upgrades on free tier
      upgrade: false            // Prevent Socket.io from attempting a WebSocket upgrade
    });

    this.socket.on('connect', () => {
      console.log('Socket connected via polling, ID:', this.socket.id);
    });

    this.socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });
  }

  emit(event: string, ...args: any[]) {
    console.log(`Socket emitting event: ${event}`, args);
    this.socket.emit(event, ...args);
  }

  on(event: string): Observable<any> {
    return new Observable(observer => {
      const handler = (data: any) => observer.next(data);
      this.socket.on(event, handler);
      return () => {
        this.socket.off(event, handler);
      };
    });
  }

  getSocketId() {
    return this.socket.id;
  }
}
