import SwiftUI

struct ContentView: View {
  var body: some View {
    VStack(spacing: 12) {
      Text(Greeting.make(for: "{{title}}"))
        .font(.largeTitle.bold())
        .accessibilityIdentifier("greeting")
      Text("Edit ContentView.swift to get started.")
        .foregroundStyle(.secondary)
    }
    .padding()
  }
}

#Preview {
  ContentView()
}
