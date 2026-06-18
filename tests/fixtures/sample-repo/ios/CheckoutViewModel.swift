import Foundation

final class CheckoutViewModel {
  private var orderCount: Int = 0

  func submitOrder() {
    orderCount += 1
    refreshTotals()
    NotificationCenter.default.post(name: .checkoutSubmitted, object: nil)
  }

  func observeCheckoutSubmitted() {
    NotificationCenter.default.addObserver(forName: .checkoutSubmitted, object: nil, queue: nil) { _ in
      self.refreshTotals()
    }
  }

  private func refreshTotals() {
    _ = orderCount
  }
}
